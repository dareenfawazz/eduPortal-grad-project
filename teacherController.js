const TeacherModel = require('../models/teacherModel');
const SubjectModel = require('../models/subjectModel');
const ClassModel = require('../models/classModel');
const ClassScheduleModel = require('../models/classScheduleModel');
const AttendanceModel = require('../models/attendanceModel');
const AssessmentModel = require('../models/assessmentModel');
const pool = require('../config/db');
const puppeteer = require('puppeteer');
const path = require('path');

function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

function isValidISODate(dateStr) {
  return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function processTimetableRows(rows) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const scheduleByDay = {};
  dayNames.forEach((_, i) => (scheduleByDay[i + 1] = []));

  (rows || []).forEach((entry) => {
    if (scheduleByDay[entry.day_of_week]) scheduleByDay[entry.day_of_week].push(entry);
  });

  const allTimes = new Set();
  (rows || []).forEach((e) => allTimes.add(e.start_time));
  const sortedTimes = Array.from(allTimes).sort();

  return { scheduleByDay, dayNames, sortedTimes };
}

async function getTeacherSubjectsInClass(teacher_profile_id, classId) {
  const query = `
    SELECT s.subject_name, s.id as subject_id 
    FROM class_subject_teachers cst
    JOIN subjects s ON cst.subject_id = s.id
    WHERE cst.teacher_id = $1 AND cst.class_id = $2
    ORDER BY s.subject_name
  `;
  const result = await pool.query(query, [teacher_profile_id, classId]);
  return result.rows;
}

async function getTeacherAccessibleClasses(teacher_profile_id) {
  const homeClass = (await TeacherModel.getHomeClassForTeacher(teacher_profile_id)).rows[0] || null;
  const subjectClassRows = (await TeacherModel.getSubjectClassesForTeacher(teacher_profile_id)).rows;

  const classMap = {};

  if (homeClass) {
    classMap[homeClass.id] = {
      id: homeClass.id,
      grade_level: homeClass.grade_level,
      class_name: homeClass.class_name
    };
  }

  for (const row of subjectClassRows) {
    if (!classMap[row.class_id]) {
      classMap[row.class_id] = {
        id: row.class_id,
        grade_level: row.grade_level,
        class_name: row.class_name
      };
    }
  }

  return Object.values(classMap).sort((a, b) => {
    const ag = String(a.grade_level || '');
    const bg = String(b.grade_level || '');
    if (ag !== bg) return ag.localeCompare(bg);
    return String(a.class_name || '').localeCompare(String(b.class_name || ''));
  });
}

async function getActiveTermId() {
  const res = await pool.query(
    `SELECT id
     FROM academic_terms
     WHERE is_active = true
     ORDER BY start_date DESC
     LIMIT 1`
  );
  return res.rows[0]?.id || null;
}

module.exports = {
  // ===========================
  // Dashboard
  // ===========================
  dashboard: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const result = await TeacherModel.getTeacherProfile(user_id);
      const profile = result.rows[0];
      const teacher_profile_id = profile.id;

      const classes = await getTeacherAccessibleClasses(teacher_profile_id);

      let totalStudents = 0;
      if (classes.length > 0) {
          const classIds = classes.map(c => c.id);
          const studentCountRes = await pool.query(
              'SELECT COUNT(*) FROM student_profiles WHERE class_id = ANY($1::int[])',
              [classIds]
          );
          totalStudents = parseInt(studentCountRes.rows[0].count);
      }

      const recentAssessments = await pool.query(
          `SELECT a.title, c.grade_level, c.class_name, a.created_at 
            FROM assessments a
            JOIN classes c ON a.class_id = c.id
            WHERE a.teacher_id = $1
            ORDER BY a.created_at DESC LIMIT 5`,
          [teacher_profile_id]
      );

      res.render('teacher/dashboard', {
        title: 'Teacher Dashboard',
        user: req.session.user,
        profile,
        classes,
        totalStudents,
        recentAssessments: recentAssessments.rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error loading dashboard');
    }
  },

  // ===========================
  // Assignments Management
  // ===========================
  createAssignmentPage: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const workloadRes = await TeacherModel.getSubjectClassesForTeacher(t_id);
      const activeTermId = await getActiveTermId();

      res.render('teacher/assignments/create', {
        title: 'Create Assignment',
        user: req.session.user,
        workload: workloadRes.rows,
        error: activeTermId ? null : 'No active academic term found. Assignments cannot be created.'
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error loading assignment creation page.");
    }
  },

  createAssignment: async (req, res) => {
    const client = await pool.connect();
    try {
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const { workload_info, title, description, due_date, max_points } = req.body;
      const [class_id, subject_id] = workload_info.split('-').map(Number);
      const activeTermId = await getActiveTermId();

      if (!activeTermId) return res.status(400).send("No active term.");

      await client.query('BEGIN');

      // 1. Insert into assignments table
      await client.query(
        `INSERT INTO assignments 
          (title, description, subject_id, class_id, term_id, teacher_id, due_date, max_points)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [title.trim(), description, subject_id, class_id, activeTermId, t_id, due_date, max_points]
      );

      // 2. Insert into assessments table
      // FIX: Using 'quiz' as the type to satisfy chk_assessment_type error
      await client.query(
        `INSERT INTO assessments 
          (term_id, class_id, subject_id, teacher_id, title, assessment_type, max_score, weight, assessment_date, is_published, category)
          VALUES ($1, $2, $3, $4, $5, 'quiz', $6, 10, $7, true, 'quiz')
          ON CONFLICT (class_id, subject_id, title) DO UPDATE SET updated_at = NOW()`,
        [activeTermId, class_id, subject_id, t_id, `HW: ${title.trim()}`, max_points, due_date]
      );

      await client.query('COMMIT');
      res.redirect('/teacher/assignments/manage?message=Assignment published and synced to gradebook');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error("Error saving assignment and syncing to assessments.", err);
      res.status(500).send("Error saving assignment and syncing to assessments.");
    } finally {
      client.release();
    }
  },

  manageAssignments: async (req, res) => {
    try {
        const user_id = req.session.user.id;
        const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
        
        const assignmentsRes = await pool.query(
            `SELECT a.*, s.subject_name, c.class_name, c.grade_level,
                    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id) as submission_count
             FROM assignments a
             JOIN subjects s ON a.subject_id = s.id
             JOIN classes c ON a.class_id = c.id
             JOIN academic_terms t ON a.term_id = t.id
             WHERE a.teacher_id = $1 AND t.is_active = true
             ORDER BY a.due_date ASC`,
            [t_id]
        );

        res.render('teacher/assignments/index', {
            title: 'Manage Assignments',
            user: req.session.user,
            assignments: assignmentsRes.rows,
            message: req.query.message || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading assignments.");
    }
  },

  editAssignmentPage: async (req, res) => {
    try {
      const assignmentId = req.params.id;
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);

      const assignmentRes = await pool.query(
        `SELECT a.*, s.subject_name, c.class_name, c.grade_level 
         FROM assignments a
         JOIN subjects s ON s.id = a.subject_id
         JOIN classes c ON c.id = a.class_id
         WHERE a.id = $1 AND a.teacher_id = $2`,
        [assignmentId, t_id]
      );

      if (assignmentRes.rows.length === 0) return res.status(404).send("Unauthorized or not found.");

      res.render('teacher/assignments/edit', {
        title: 'Edit Assignment',
        user: req.session.user,
        assignment: assignmentRes.rows[0]
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error loading edit page.");
    }
  },

  updateAssignment: async (req, res) => {
    try {
      const assignmentId = req.params.id;
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const { title, description, due_date, max_points } = req.body;

      await pool.query(
        `UPDATE assignments 
          SET title = $1, description = $2, due_date = $3, max_points = $4
          WHERE id = $5 AND teacher_id = $6`,
        [title.trim(), description, due_date, max_points, assignmentId, t_id]
      );

      res.redirect('/teacher/assignments/manage?message=Assignment updated successfully');
    } catch (err) {
      console.error(err);
      res.status(500).send("Error updating assignment.");
    }
  },

  // ===========================
  // Delete Assignment & Sync
  // ===========================
  deleteAssignment: async (req, res) => {
    const client = await pool.connect();
    try {
      const assignmentId = req.params.id;
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);

      // 1. Get assignment details first to find the linked assessment title
      const assignRes = await client.query(
        `SELECT title, class_id, subject_id FROM assignments WHERE id = $1 AND teacher_id = $2`,
        [assignmentId, t_id]
      );

      if (assignRes.rows.length === 0) {
        return res.status(404).send("Assignment not found or unauthorized.");
      }

      const { title, class_id, subject_id } = assignRes.rows[0];
      const assessmentTitle = `HW: ${title}`;

      await client.query('BEGIN');

      // 2. Delete student submissions first
      await client.query(`DELETE FROM assignment_submissions WHERE assignment_id = $1`, [assignmentId]);

      // 3. Delete the assignment task
      await client.query(`DELETE FROM assignments WHERE id = $1`, [assignmentId]);

      // 4. Delete the synced assessment and its associated student scores
      // Note: We delete scores first for data integrity
      await client.query(
        `DELETE FROM student_assessment_scores 
         WHERE assessment_id IN (SELECT id FROM assessments WHERE class_id = $1 AND subject_id = $2 AND title = $3)`,
        [class_id, subject_id, assessmentTitle]
      );

      await client.query(
        `DELETE FROM assessments WHERE class_id = $1 AND subject_id = $2 AND title = $3`,
        [class_id, subject_id, assessmentTitle]
      );

      await client.query('COMMIT');
      res.redirect('/teacher/assignments/manage?message=Assignment and linked grades deleted successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error("Delete Error:", err);
      res.status(500).send("Error deleting assignment and synced data.");
    } finally {
      client.release();
    }
  },

  viewAssignmentSubmissions: async (req, res) => {
    try {
      const assignmentId = req.params.id;
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);

      const assignmentRes = await pool.query(
        `SELECT a.*, s.subject_name, c.class_name, c.grade_level 
         FROM assignments a
         JOIN subjects s ON s.id = a.subject_id
         JOIN classes c ON c.id = a.class_id
         WHERE a.id = $1 AND a.teacher_id = $2`,
        [assignmentId, t_id]
      );

      if (assignmentRes.rows.length === 0) return res.status(404).send("Unauthorized.");
      const assignment = assignmentRes.rows[0];

      const submissionsRes = await pool.query(
        `SELECT sp.id as student_id, sp.first_name, sp.last_name, sp.student_number,
                asub.id as submission_id, asub.submitted_at, asub.file_path, 
                asub.grade, asub.feedback, asub.status
         FROM student_profiles sp
         LEFT JOIN assignment_submissions asub ON asub.student_id = sp.id AND asub.assignment_id = $1
         WHERE sp.class_id = $2
         ORDER BY sp.last_name ASC`,
        [assignmentId, assignment.class_id]
      );

      res.render('teacher/assignments/review', {
        title: 'Review Assignment',
        user: req.session.user,
        assignment,
        students: submissionsRes.rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error loading review page.");
    }
  },

  gradeSubmission: async (req, res) => {
    const client = await pool.connect();
    try {
      const { assignmentId, studentId } = req.params;
      const { grade, feedback } = req.body;
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);

      const verify = await client.query(`SELECT 1 FROM assignments WHERE id = $1 AND teacher_id = $2`, [assignmentId, t_id]);
      if (verify.rows.length === 0) return res.status(403).send("Unauthorized.");

      await client.query('BEGIN');

      await client.query(
        `INSERT INTO assignment_submissions (assignment_id, student_id, grade, feedback, status)
          VALUES ($1, $2, $3, $4, 'graded')
          ON CONFLICT (assignment_id, student_id) 
          DO UPDATE SET grade = EXCLUDED.grade, feedback = EXCLUDED.feedback, status = 'graded'`,
        [assignmentId, studentId, grade, feedback]
      );

      const assignRes = await client.query(
          `SELECT subject_id, title, max_points, term_id, class_id 
            FROM assignments WHERE id = $1`,
          [assignmentId]
      );
      const a = assignRes.rows[0];

      const assessmentRes = await client.query(
          `INSERT INTO assessments 
            (term_id, class_id, subject_id, teacher_id, title, assessment_type, max_score, weight, assessment_date, is_published, category)
            VALUES ($1, $2, $3, $4, $5, 'quiz', $6, 10, NOW(), true, 'quiz')
            ON CONFLICT (class_id, subject_id, title) DO UPDATE SET updated_at = NOW()
            RETURNING id`,
          [a.term_id, a.class_id, a.subject_id, t_id, `HW: ${a.title}`, a.max_points]
      );

      const assessment_id = assessmentRes.rows[0].id;

      await client.query(
          `INSERT INTO student_assessment_scores 
            (student_id, assessment_id, score, status, graded_by, graded_at)
            VALUES ($1, $2, $3, 'graded', $4, NOW())
            ON CONFLICT (student_id, assessment_id) 
            DO UPDATE SET score = EXCLUDED.score, graded_at = NOW()`,
          [studentId, assessment_id, grade, t_id]
      );

      await client.query('COMMIT');
      res.redirect(`/teacher/assignments/view/${assignmentId}?message=Grade updated and synced to assessments`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).send("Error saving grade.");
    } finally {
      client.release();
    }
  },

  // ===========================
  // Resource Sharing
  // ===========================
  uploadResourcePage: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const workloadRes = await TeacherModel.getSubjectClassesForTeacher(t_id);

      res.render('teacher/resources/upload', {
        title: 'Upload Learning Material',
        user: req.session.user,
        workload: workloadRes.rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error loading resource upload page.");
    }
  },

  uploadResource: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const { workload_info, title, description } = req.body;
      const [class_id, subject_id] = workload_info.split('-').map(Number);

      if (!req.file) return res.status(400).send("No file uploaded.");

      const filePath = `/uploads/resources/${req.file.filename}`;
      const fileType = path.extname(req.file.originalname).replace('.', '').toLowerCase();

      await pool.query(
        `INSERT INTO subject_resources 
          (subject_id, class_id, teacher_id, title, description, file_path, file_type) 
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [subject_id, class_id, t_id, title.trim(), description, filePath, fileType]
      );

      res.redirect('/teacher/dashboard?message=Learning material uploaded successfully');
    } catch (err) {
      console.error(err);
      res.status(500).send("Error uploading resource.");
    }
  },

  manageResources: async (req, res) => {
    try {
        const t_id = await TeacherModel.getTeacherProfileIdByUserId(req.session.user.id);
        
        const resourcesRes = await pool.query(
            `SELECT r.*, s.subject_name, c.class_name, c.grade_level 
             FROM subject_resources r
             JOIN subjects s ON r.subject_id = s.id
             JOIN classes c ON r.class_id = c.id
             WHERE r.teacher_id = $1
             ORDER BY r.created_at DESC`,
            [t_id]
        );

        res.render('teacher/resources/index', {
            title: 'Manage Materials',
            user: req.session.user,
            resources: resourcesRes.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading resource manager.");
    }
  },

  deleteResource: async (req, res) => {
    try {
        const t_id = await TeacherModel.getTeacherProfileIdByUserId(req.session.user.id);
        const resourceId = req.params.id;

        await pool.query(
            `DELETE FROM subject_resources WHERE id = $1 AND teacher_id = $2`,
            [resourceId, t_id]
        );

        res.redirect('/teacher/resources/manage?message=Resource deleted');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting resource.");
    }
  },

  // ===========================
  // My Classes
  // ===========================
  myClasses: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const teacher_profile_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      if (!teacher_profile_id) return res.send("No teacher profile found.");
      const homeClassRes = await TeacherModel.getHomeClassForTeacher(teacher_profile_id);
      const subjectClassesRes = await TeacherModel.getSubjectClassesForTeacher(teacher_profile_id);
      const homeClass = homeClassRes.rows[0] || null;
      const subjectClasses = subjectClassesRes.rows || [];
      const classMap = {};
      if (homeClass) classMap[homeClass.id] = { ...homeClass, role: "Homeroom Teacher", subjects: [] };
      for (const row of subjectClasses) {
        if (!classMap[row.class_id]) {
          classMap[row.class_id] = { id: row.class_id, grade_level: row.grade_level, class_name: row.class_name, role: "Subject Teacher", subjects: [row.subject_name] };
        } else {
          if (!classMap[row.class_id].subjects.includes(row.subject_name)) classMap[row.class_id].subjects.push(row.subject_name);
        }
      }
      const classes = Object.values(classMap).map(c => ({ ...c, subjects: (c.subjects || []).sort() }));
      res.render('teacher/my_classes', { title: "My Classes", user: req.session.user, homeClass, subjectClasses, classes });
    } catch (err) { console.error(err); res.status(500).send("Error loading classes."); }
  },

  viewClass: async (req, res) => {
    try {
      const classId = toInt(req.params.id);
      const user_id = req.session.user.id;
      const teacher_profile_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      if (!teacher_profile_id) return res.send("No teacher profile found.");
      const isHomeroom = await TeacherModel.isTeacherHomeroomForClass(teacher_profile_id, classId);
      const isAssigned = await TeacherModel.isTeacherAssignedToClass(teacher_profile_id, classId);
      if (!isHomeroom && !isAssigned) return res.status(403).send("Forbidden: You do not teach this class.");
      const classRes = await ClassModel.getClassById(classId);
      const classData = classRes.rows[0];
      if (!classData) return res.status(404).send("Class not found.");
      const studentsRes = await ClassModel.getStudentsInClass(classId);
      const students = studentsRes.rows;
      const teacherSubjects = await getTeacherSubjectsInClass(teacher_profile_id, classId);
      const scheduleRes = await ClassScheduleModel.getScheduleByClassId(classId);
      const timetable = processTimetableRows(scheduleRes.rows);
      res.render('teacher/class_view', { title: `Class ${classData.grade_level} - ${classData.class_name}`, user: req.session.user, classData, students, teacherSubjects, isHomeroom, isAssigned, ...timetable });
    } catch (err) { console.error(err); res.status(500).send("Error loading class view."); }
  },

  showAttendanceForClass: async (req, res) => {
    try {
      const classId = toInt(req.params.id);
      const user_id = req.session.user.id;
      const teacher_profile_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      if (!teacher_profile_id) return res.send("No teacher profile found.");
      const isHomeroom = await TeacherModel.isTeacherHomeroomForClass(teacher_profile_id, classId);
      const isAssigned = await TeacherModel.isTeacherAssignedToClass(teacher_profile_id, classId);
      if (!isHomeroom && !isAssigned) return res.status(403).send("Forbidden: You do not teach this class.");
      const classRes = await ClassModel.getClassById(classId);
      const classData = classRes.rows[0];
      if (!classData) return res.status(404).send("Class not found.");
      const studentsRes = await ClassModel.getStudentsInClass(classId);
      const students = studentsRes.rows;
      const teacherSubjects = await getTeacherSubjectsInClass(teacher_profile_id, classId);
      const todayISO = new Date().toISOString().split('T')[0];
      const selectedDate = isValidISODate(req.query.attendance_date) ? req.query.attendance_date : todayISO;
      const selectedSubjectId = toInt(req.query.subject_id) || (teacherSubjects[0] ? toInt(teacherSubjects[0].subject_id) : null);
      let absentStudentIds = [];
      if (selectedSubjectId && selectedDate) {
        const ids = await AttendanceModel.getAbsentStudentIdsForClassDateSubject(classId, selectedDate, selectedSubjectId);
        absentStudentIds = ids.map(id => String(id));
      }
      res.render('teacher/class_attendance', { title: `Attendance - ${classData.grade_level} ${classData.class_name}`, user: req.session.user, classData, students, teacherSubjects, selectedSubjectId, selectedDate, absentStudentIds, message: req.query.message || (teacherSubjects.length === 0 ? 'No subjects assigned to you in this class.' : null) });
    } catch (err) { console.error(err); res.status(500).send("Error loading attendance page."); }
  },

  saveAttendanceForClass: async (req, res) => {
    const client = await pool.connect();
    try {
      const classId = toInt(req.params.id);
      const user_id = req.session.user.id;
      const teacher_profile_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      if (!teacher_profile_id) return res.send("No teacher profile found.");
      const isHomeroom = await TeacherModel.isTeacherHomeroomForClass(teacher_profile_id, classId);
      const isAssigned = await TeacherModel.isTeacherAssignedToClass(teacher_profile_id, classId);
      if (!isHomeroom && !isAssigned) return res.status(403).send("Forbidden: You do not teach this class.");
      const { attendance_date, subject_id, absent_students } = req.body;
      if (!isValidISODate(attendance_date)) return res.status(400).send("Invalid date.");
      const subId = toInt(subject_id);
      if (!subId) return res.status(400).send("Subject is required.");
      const checkAssign = await TeacherModel.isTeacherAssignedToClassSubject(classId, subId, teacher_profile_id);
      if (!checkAssign) return res.status(403).send("Forbidden: You are not assigned to this subject for this class.");
      const studentsRes = await ClassModel.getStudentsInClass(classId);
      const students = studentsRes.rows;
      const absentSet = new Set(Array.isArray(absent_students) ? absent_students.map(String) : (absent_students ? [String(absent_students)] : []));
      await client.query('BEGIN');
      for (const st of students) {
        const student_profile_id = st.id;
        const isAbsent = absentSet.has(String(student_profile_id));
        const status = isAbsent ? 'absent' : 'present';
        const dayRes = await client.query(`INSERT INTO attendance_days (student_id, attendance_date, status) VALUES ($1, $2, $3) ON CONFLICT (student_id, attendance_date) DO UPDATE SET status = EXCLUDED.status RETURNING id`, [student_profile_id, attendance_date, status]);
        const day_id = dayRes.rows[0].id;
        await client.query(`INSERT INTO attendance_sessions (day_id, subject_id, status, session_label) VALUES ($1, $2, $3, $4) ON CONFLICT (day_id, subject_id) DO UPDATE SET status = EXCLUDED.status`, [day_id, subId, status, 'session']);
      }
      await client.query('COMMIT');
      const msg = encodeURIComponent('Attendance saved successfully');
      res.redirect(`/teacher/classes/${classId}/attendance?attendance_date=${encodeURIComponent(attendance_date)}&subject_id=${encodeURIComponent(subId)}&message=${msg}`);
    } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).send("Error saving attendance."); } finally { client.release(); }
  },

  classGradesPage: async (req, res) => {
    try {
      const classId = toInt(req.params.id);
      const user_id = req.session.user.id;
      const teacher_profile_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      if (!teacher_profile_id) return res.send("No teacher profile found.");
      const classRes = await ClassModel.getClassById(classId);
      const classData = classRes.rows[0];
      if (!classData) return res.status(404).send("Class not found.");
      const teacherSubjects = await getTeacherSubjectsInClass(teacher_profile_id, classId);
      const selectedSubjectId = toInt(req.query.subject_id) || (teacherSubjects[0] ? toInt(teacherSubjects[0].subject_id) : null);
      if (!selectedSubjectId) {
        return res.render('teacher/assessments/index', { title: 'Grading System', user: req.session.user, classData, teacherSubjects, selectedSubjectId: null, assessments: [], message: req.query.message || 'No subjects assigned to you in this class.' });
      }
      const assessmentsRes = await pool.query(`SELECT a.id, a.class_id, a.subject_id, a.title, COALESCE(a.category, a.assessment_type) AS category, a.assessment_type, a.weight, a.max_score, a.assessment_date FROM assessments a WHERE a.class_id = $1 AND a.subject_id = $2 ORDER BY a.assessment_date NULLS LAST, a.id DESC`, [classId, selectedSubjectId]);
      return res.render('teacher/assessments/index', { title: 'Grading System', user: req.session.user, classData, teacherSubjects, selectedSubjectId, assessments: assessmentsRes.rows || [], message: req.query.message || null });
    } catch (err) { console.error('classGradesPage error:', err); return res.status(500).send('Error loading grading system.'); }
  },

  createAssessmentPage: async (req, res) => {
    try {
      const classId = toInt(req.params.id);
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const classData = (await ClassModel.getClassById(classId)).rows[0];
      const teacherSubjects = await getTeacherSubjectsInClass(t_id, classId);
      const activeTermId = await getActiveTermId();
      res.render('teacher/assessments/create', { title: 'Create Assessment', user: req.session.user, classData, teacherSubjects, selectedSubjectId: toInt(req.query.subject_id), error: activeTermId ? null : 'No active academic term found.', form: { title: '', category: 'quiz', weight: '', max_score: '', assessment_date: '' } });
    } catch (err) { console.error('createAssessmentPage error:', err); return res.status(500).send('Error loading create page.'); }
  },

  createAssessment: async (req, res) => {
    try {
      const classId = toInt(req.params.id);
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const { subject_id, title, category, weight, max_score, assessment_date } = req.body;
      const activeTermId = await getActiveTermId();
      if (!activeTermId) return res.status(400).send("No active academic term found.");
      const typeForDb = String(category || 'quiz').toLowerCase().trim();
      await AssessmentModel.createAssessment({ term_id: activeTermId, class_id: classId, subject_id: toInt(subject_id), teacher_id: t_id, title: title.trim(), assessment_type: typeForDb, max_score: parseFloat(max_score), weight: parseFloat(weight), assessment_date: isValidISODate(assessment_date) ? assessment_date : null, category: typeForDb });
      res.redirect(`/teacher/classes/${classId}/grades?subject_id=${subject_id}&message=Assessment created successfully`);
    } catch (err) { console.error('createAssessment error:', err); res.status(500).send('Error creating assessment: ' + err.message); }
  },

  gradeAssessmentPage: async (req, res) => {
    try {
      const classId = toInt(req.params.id);
      const assessmentId = toInt(req.params.assessmentId);
      const assessmentRes = await pool.query(`SELECT a.*, s.subject_name FROM assessments a JOIN subjects s ON s.id = a.subject_id WHERE a.id = $1 AND a.class_id = $2`, [assessmentId, classId]);
      const assessment = assessmentRes.rows[0];
      if (!assessment) return res.status(404).send('Assessment not found.');
      const studentsRes = await ClassModel.getStudentsInClass(classId);
      const students = studentsRes.rows || [];
      const scoresRes = await pool.query(`SELECT student_id, score FROM student_assessment_scores WHERE assessment_id = $1`, [assessmentId]);
      const scoreMap = {};
      scoresRes.rows.forEach(r => scoreMap[String(r.student_id)] = r.score);
      return res.render('teacher/assessments/grade', { title: 'Enter Grades', user: req.session.user, classData: { id: classId }, assessment, students, scoreMap, message: req.query.message || null });
    } catch (err) { console.error('gradeAssessmentPage error:', err); return res.status(500).send('Error loading grade page.'); }
  },

  saveAssessmentGrades: async (req, res) => {
    const client = await pool.connect();
    try {
      const assessmentId = toInt(req.params.assessmentId);
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(req.session.user.id);
      await client.query('BEGIN');
      for (const key in req.body) {
        if (key.startsWith('score_')) {
          const sid = toInt(key.split('_')[1]);
          const val = parseFloat(req.body[key]);
          if (!isNaN(val)) {
            await client.query(`INSERT INTO student_assessment_scores (assessment_id, student_id, score, status, graded_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (assessment_id, student_id) DO UPDATE SET score = EXCLUDED.score, graded_at = NOW()`, [assessmentId, sid, val, 'graded', t_id]);
          }
        }
      }
      await client.query('COMMIT');
      res.redirect(req.originalUrl + '?message=Grades saved successfully');
    } catch (err) { await client.query('ROLLBACK'); res.status(500).send("Error saving grades."); } finally { client.release(); }
  },

  classMarksReportPage: async (req, res) => {
    try {
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(req.session.user.id);
      const classes = await getTeacherAccessibleClasses(t_id);
      const { class_id, subject_id } = req.query;
      let marksData = null;
      let teacherSubjects = [];
      if (class_id) {
        teacherSubjects = await getTeacherSubjectsInClass(t_id, class_id);
        if (subject_id) {
          marksData = (await AssessmentModel.getClassMarksReport(class_id, subject_id)).rows;
        }
      }
      res.render('teacher/reports/marks_class', { title: 'Marks Report', user: req.session.user, classes, teacherSubjects, marksData, classId: class_id, subjectId: subject_id });
    } catch (err) { console.error('Marks report error:', err); res.status(500).send("Error generating marks report."); }
  },

  classMarksReportPdf: async (req, res) => {
    try {
      const { class_id, subject_id } = req.query;
      const classData = (await ClassModel.getClassById(class_id)).rows[0];
      const subjectRes = await SubjectModel.getSubjectById(subject_id);
      const subjectData = subjectRes.rows[0];
      const marksData = (await AssessmentModel.getClassMarksReport(class_id, subject_id)).rows;
      res.render('teacher/reports/marks_class_pdf', { classData, subjectData, marksData, layout: false }, async (err, html) => {
        if (err) return res.status(500).send("Error rendering PDF template.");
        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: 'new' });
        const page = await browser.newPage();
        await page.setContent(html);
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        await browser.close();
        res.setHeader('Content-Disposition', `attachment; filename="marks_${classData.class_name}.pdf"`);
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { console.error('PDF marks error:', err); res.status(500).send("Error generating PDF."); }
  },

  myTimetable: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(user_id);
      const result = await ClassScheduleModel.getTeacherSchedule(t_id);
      res.render('teacher/my_timetable', { title: 'My Timetable', user: req.session.user, schedule: result.rows, dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], message: req.query.message || null });
    } catch (err) { res.status(500).send("Error loading timetable."); }
  },

  generateFullTimetablePdf: async (req, res) => {
    try {
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(req.session.user.id);
      const result = await ClassScheduleModel.getTeacherSchedule(t_id);
      const schedule = result.rows;
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const { scheduleByDay, sortedTimes } = processTimetableRows(schedule);
      res.render('teacher/my_timetable_pdf', { title: 'My Timetable (PDF)', user: req.session.user, schedule, dayNames, scheduleByDay, sortedTimes, layout: false }, async (err, html) => {
        if (err) return res.status(500).send("Error rendering PDF.");
        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: 'new' });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        await browser.close();
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { res.status(500).send("Error generating PDF."); }
  },

  generateTimetablePdf: async (req, res) => {
    try {
      const classId = toInt(req.params.id);
      const classData = (await pool.query(`SELECT id, grade_level, class_name FROM classes WHERE id = $1`, [classId])).rows[0];
      const scheduleRes = await ClassScheduleModel.getScheduleByClassId(classId);
      res.render('admin/classes/timetable_pdf', { title: `Timetable - ${classData.class_name}`, user: req.session.user, classData, layout: false, schedule: scheduleRes.rows, dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], sortedTimes: [], scheduleByDay: {} }, async (err, html) => {
        if (err) return res.status(500).send("Error rendering PDF.");
        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: 'new' });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        await browser.close();
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { res.status(500).send("Error generating PDF."); }
  },

  showEditProfile: async (req, res) => {
    try {
      const result = await TeacherModel.getTeacherProfile(req.session.user.id);
      res.render('teacher/profile_edit', { title: 'Edit Profile', user: req.session.user, profile: result.rows[0], message: null });
    } catch (err) { res.status(500).send('Error loading profile'); }
  },

  updateProfile: async (req, res) => {
    try {
      const { phone_number, address, emergency_contact } = req.body;
      await TeacherModel.updateTeacherProfile(req.session.user.id, phone_number, address, emergency_contact);
      res.redirect('/teacher/dashboard');
    } catch (err) { res.status(500).send('Error updating profile'); }
  },

  classAttendanceReportPage: async (req, res) => {
    try {
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(req.session.user.id);
      const classes = await getTeacherAccessibleClasses(t_id);
      const classId = toInt(req.query.class_id);
      let reportRows = classId ? await AttendanceModel.getClassAttendanceReport(classId) : null;
      res.render('teacher/reports/attendance_class', { title: 'Class Attendance Report', user: req.session.user, classes, selectedClass: classes.find(c => c.id === classId), reportRows, classId, error: null });
    } catch (err) { res.status(500).send('Error loading report.'); }
  },

  classAttendanceReportPdf: async (req, res) => {
    try {
      const t_id = await TeacherModel.getTeacherProfileIdByUserId(req.session.user.id);
      const classes = await getTeacherAccessibleClasses(t_id);
      const classId = toInt(req.query.class_id);
      const selectedClass = classes.find(c => c.id === classId);
      const reportRows = await AttendanceModel.getClassAttendanceReport(classId);
      res.render('teacher/reports/attendance_class_pdf', { title: 'Class Attendance Report (PDF)', selectedClass, reportRows, layout: false }, async (err, html) => {
        if (err) return res.status(500).send('Error rendering PDF HTML.');
        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: 'new' });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        await browser.close();
        res.setHeader('Content-Disposition', `attachment; filename="attendance_${selectedClass.class_name}.pdf"`);
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { res.status(500).send('PDF generation error.'); }
  }
};