const StudentModel = require('../models/studentModel');
const AttendanceModel = require('../models/attendanceModel');
const pool = require('../config/db');
const puppeteer = require('puppeteer');

/**
 * Helper to process raw timetable rows into a grouped format
 */
function processTimetableData(scheduleResult) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const scheduleByDay = {};
  dayNames.forEach((_, i) => (scheduleByDay[i + 1] = []));

  scheduleResult.rows.forEach((entry) => {
    if (scheduleByDay[entry.day_of_week]) {
      scheduleByDay[entry.day_of_week].push(entry);
    }
  });

  const allTimes = new Set();
  scheduleResult.rows.forEach((e) => allTimes.add(e.start_time));
  const sortedTimes = Array.from(allTimes).sort();

  return { scheduleByDay, dayNames, sortedTimes };
}

function parseGradeNumber(grade_level) {
  if (!grade_level) return null;
  const match = String(grade_level).match(/(KG\d+|\d+)/i);
  if (!match) return null;
  if (match[1].toUpperCase().startsWith('KG')) return match[1].toUpperCase(); 
  return parseInt(match[1], 10);
}

function getBandForGradeLevel(grade_level) {
  const g = parseGradeNumber(grade_level);
  if (g === 'KG1' || g === 'KG2') return 'KG1 - KG2';
  if (typeof g === 'number' && g >= 1 && g <= 3) return 'Grade 1 - Grade 3';
  if (typeof g === 'number' && g >= 4 && g <= 8) return 'Grade 4 - Grade 8';
  if (typeof g === 'number' && g >= 9 && g <= 12) return 'Grade 9 - Grade 12';
  return null;
}

function getConstantSubjectNamesForGradeLevel(grade_level) {
  const band = getBandForGradeLevel(grade_level);
  if (band === 'KG1 - KG2') return ['Math', 'Arabic', 'English', 'Science', 'Art', 'Sports'];
  return ['Math', 'Arabic', 'English', 'Science', 'Art', 'Sports', 'History'];
}

module.exports = {
  // Main Dashboard Logic
  dashboard: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const profileRes = await StudentModel.getStudentProfile(user_id);
      if (!profileRes.rows.length) return res.status(404).send('Profile not found.');
      const profile = profileRes.rows[0];

      let timetable = { scheduleByDay: {}, dayNames: [], sortedTimes: [] };
      let subjects = [];

      if (profile.class_id) {
        const scheduleRes = await StudentModel.getStudentSchedule(profile.class_id);
        timetable = processTimetableData(scheduleRes);
        const allowedSubjectNames = getConstantSubjectNamesForGradeLevel(profile.grade_level);
        const subjectsRes = await StudentModel.getStudentSubjects(profile.class_id, allowedSubjectNames);
        subjects = subjectsRes.rows;
      }

      res.render('student/dashboard', {
        title: 'Student Dashboard',
        user: req.session.user,
        profile,
        subjects,
        ...timetable,
        message: req.query.message || null
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error loading dashboard');
    }
  },

  // View Detailed Subject Marks & Resources
  viewSubject: async (req, res) => {
    try {
      const subjectId = req.params.id;
      const user_id = req.session.user.id;
      const profileRes = await StudentModel.getStudentProfile(user_id);
      const profile = profileRes.rows[0];

      const subjectQuery = `
        SELECT s.*, tp.first_name AS teacher_first_name, tp.last_name AS teacher_last_name
        FROM subjects s
        LEFT JOIN class_subject_teachers cst ON cst.subject_id = s.id AND cst.class_id = $2
        LEFT JOIN teacher_profiles tp ON tp.id = cst.teacher_id
        WHERE s.id = $1 LIMIT 1`;

      const subjectRes = await pool.query(subjectQuery, [subjectId, profile.class_id]);
      const marksRes = await StudentModel.getSubjectMarks(profile.id, subjectId);

      // Implementation for Resource Sharing
      const resourcesRes = await pool.query(
        `SELECT * FROM subject_resources 
         WHERE subject_id = $1 AND class_id = $2 
         ORDER BY created_at DESC`,
        [subjectId, profile.class_id]
      );

      res.render('student/subject_view', {
        title: subjectRes.rows[0].subject_name,
        user: req.session.user,
        subject: subjectRes.rows[0],
        marks: marksRes.rows,
        resources: resourcesRes.rows, // New feature pass-through
        profile
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server Error');
    }
  },

  // List All Active Assignments
  viewAssignments: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const studentRes = await pool.query('SELECT id, class_id FROM student_profiles WHERE user_id = $1', [user_id]);
      const student = studentRes.rows[0];

      const assignmentsRes = await pool.query(
        `SELECT a.*, s.subject_name, tp.first_name as teacher_name, asub.status as submission_status, asub.grade
         FROM assignments a
         JOIN subjects s ON a.subject_id = s.id
         JOIN teacher_profiles tp ON a.teacher_id = tp.id
         JOIN academic_terms t ON a.term_id = t.id
         LEFT JOIN assignment_submissions asub ON asub.assignment_id = a.id AND asub.student_id = $1
         WHERE a.class_id = $2 AND t.is_active = true
         ORDER BY a.due_date ASC`,
        [student.id, student.class_id]
      );

      res.render('student/assignments/index', { 
        title: 'My Assignments', 
        user: req.session.user, 
        assignments: assignmentsRes.rows 
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error loading assignments");
    }
  },

  // View Individual Assignment Details
  viewAssignmentDetails: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const studentRes = await pool.query('SELECT id FROM student_profiles WHERE user_id = $1', [user_id]);
      const assignmentRes = await pool.query(
        `SELECT a.*, s.subject_name, tp.first_name as teacher_name, asub.file_path, asub.submitted_at, asub.grade, asub.feedback, asub.status
         FROM assignments a
         JOIN subjects s ON a.subject_id = s.id
         JOIN teacher_profiles tp ON a.teacher_id = tp.id
         LEFT JOIN assignment_submissions asub ON asub.assignment_id = a.id AND asub.student_id = $1
         WHERE a.id = $2`,
        [studentRes.rows[0].id, req.params.id]
      );
      res.render('student/assignments/view', { 
        title: 'Assignment Details', 
        user: req.session.user, 
        task: assignmentRes.rows[0] 
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error");
    }
  },

  // Handle File Submission
  submitAssignment: async (req, res) => {
    try {
      const user_id = req.session.user.id;
      const studentRes = await pool.query('SELECT id FROM student_profiles WHERE user_id = $1', [user_id]);
      if (!req.file) return res.status(400).send("No file uploaded.");
      
      const filePath = `/uploads/assignments/${req.file.filename}`;
      await pool.query(
        `INSERT INTO assignment_submissions (assignment_id, student_id, file_path, status, submitted_at)
         VALUES ($1, $2, $3, 'submitted', NOW())
         ON CONFLICT (assignment_id, student_id) 
         DO UPDATE SET file_path = EXCLUDED.file_path, submitted_at = NOW(), status = 'submitted'`,
        [req.params.id, studentRes.rows[0].id, filePath]
      );
      res.redirect(`/student/assignments/${req.params.id}?message=Submitted successfully`);
    } catch (err) {
      console.error(err);
      res.status(500).send("Upload Error");
    }
  },

  // View Attendance Summary
  viewAttendance: async (req, res) => {
    try {
      const student_id = await AttendanceModel.getStudentProfileIdByUserId(req.session.user.id);
      const report = await AttendanceModel.getAttendanceReport(student_id);
      res.render('student/attendance', { title: 'My Attendance', user: req.session.user, report });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error');
    }
  },

  // Edit Profile Page
  showEditProfile: async (req, res) => {
    try {
      const result = await StudentModel.getStudentProfile(req.session.user.id);
      res.render('student/profile_edit', { 
        title: 'Edit Profile', 
        user: req.session.user, 
        profile: result.rows[0], 
        message: null 
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error');
    }
  },

  // Update Profile Logic
  updateProfile: async (req, res) => {
    try {
      const { phone_number, address, emergency_contact } = req.body;
      await StudentModel.updateProfile(req.session.user.id, phone_number, address, emergency_contact);
      res.redirect('/student/dashboard?message=Profile updated successfully');
    } catch (err) {
      console.error(err);
      res.status(500).send('Error');
    }
  },

  // Generate Timetable as PDF
  generateTimetablePdf: async (req, res) => {
    try {
      const profileRes = await StudentModel.getStudentProfile(req.session.user.id);
      const profile = profileRes.rows[0];
      const scheduleRes = await StudentModel.getStudentSchedule(profile.class_id);
      const data = processTimetableData(scheduleRes);

      res.render('admin/classes/timetable_pdf', { 
        title: 'My Timetable', 
        user: req.session.user, 
        classData: profile, 
        ...data, 
        layout: false 
      }, async (err, html) => {
        if (err) throw err;
        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html);
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        await browser.close();
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdf);
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('PDF Error');
    }
  }
};