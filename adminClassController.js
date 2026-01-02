const ClassModel = require('../models/classModel');
const ClassScheduleModel = require('../models/classScheduleModel');
const pool = require('../config/db');
const puppeteer = require('puppeteer'); 

// Helper to load manage page data
async function loadManageClassData(classId) {
  const classDataRes = await ClassModel.getClassById(classId);
  if (!classDataRes.rows.length) return null;

  const classData = classDataRes.rows[0];

  // ✅ Get capacity + current count
  const statsRes = await ClassModel.getClassStats(classId);
  const stats = statsRes.rows[0] || {};
  const capacity = Number(stats.capacity || classData.capacity || 30);
  const enrolledCount = Number(stats.current_count || 0);
  const seatsLeft = Math.max(0, capacity - enrolledCount);
  const isFull = enrolledCount >= capacity;

  const students = (await ClassModel.getStudentsInClass(classId)).rows;

  // Homeroom teacher (optional)
  let homeroomTeacher = null;
  if (classData.homeroom_teacher_id) {
    const t = await pool.query(
      `SELECT id,
              teacher_number,
              first_name,
              last_name,
              specialization,
              email
         FROM teacher_profiles
        WHERE id = $1`,
      [classData.homeroom_teacher_id]
    );
    homeroomTeacher = t.rows[0] || null;
  }

  // subjects list (constant per class grade_level)
  const allowedSubjectNames = getConstantSubjectNamesForGradeLevel(classData.grade_level);

  // Pull only allowed subjects from DB, preserving the order in allowedSubjectNames
  const subjects = allowedSubjectNames.length
    ? (await pool.query(
        `SELECT id, subject_name
           FROM subjects
          WHERE subject_name = ANY($1::text[])
          ORDER BY array_position($1::text[], subject_name)`,
        [allowedSubjectNames]
      )).rows
    : [];

  // class subject teachers (only assigned rows)
  const classSubjects = (await ClassModel.getClassSubjectTeachers(classId)).rows;

  // Merge: show ALL constant subjects, even if not assigned yet
  const assignedBySubjectId = {};
  for (const row of classSubjects) {
    assignedBySubjectId[row.subject_id] = row;
  }

  const mergedSubjects = (subjects || []).map(s => {
    const assigned = assignedBySubjectId[s.id];
    return {
      id: s.id,
      subject_name: s.subject_name,
      teacher_full_name: assigned ? `${assigned.first_name} ${assigned.last_name}` : null,
      teacher_number: assigned ? assigned.teacher_number : null
    };
  });

  return {
    classData,
    students,
    homeroomTeacher,
    subjects,
    mergedSubjects,
    classSubjects,
    capacity,
    enrolledCount,
    seatsLeft,
    isFull
  };
}

// Helper to load ALL data for Timetable pages (manage and PDF)
async function loadTimetableData(classId) {
    const classDataRes = await ClassModel.getClassById(classId);
    if (!classDataRes.rows.length) return null;
    
    const classData = classDataRes.rows[0];
    const scheduleResult = await ClassScheduleModel.getScheduleByClassId(classId);
    
    const allowedSubjectNames = getConstantSubjectNamesForGradeLevel(classData.grade_level);
    const subjects = allowedSubjectNames.length
      ? (await pool.query(
          `SELECT id, subject_name FROM subjects WHERE subject_name = ANY($1::text[])`,
          [allowedSubjectNames]
        )).rows
      : [];
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const scheduleByDay = {};
    dayNames.forEach((_, i) => scheduleByDay[i + 1] = []);
    
    scheduleResult.rows.forEach(entry => {
        if (scheduleByDay[entry.day_of_week]) {
            scheduleByDay[entry.day_of_week].push(entry);
        }
    });

    const allTimes = new Set();
    dayNames.forEach((_, i) => {
        (scheduleByDay[i + 1] || []).forEach(e => {
            allTimes.add(e.start_time);
        });
    });
    const sortedTimes = Array.from(allTimes).sort();

    return { classData, subjects, scheduleByDay, dayNames, sortedTimes };
}

// NEW HELPER: Fetches all teachers eligible for a specific grade band
async function getTeachersByGradeBand(gradeBand) {
    return (await pool.query(
        `SELECT id, teacher_number, first_name, last_name, specialization
         FROM teacher_profiles
         WHERE grade_band = $1
         ORDER BY last_name, first_name`,
        [gradeBand]
    )).rows;
}


// ✅ Central list so we reuse it for buttons + validation
function getAllGradeLevels() {
  return [
    "KG1", "KG2",
    "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5",
    "Grade 6", "Grade 7", "Grade 8", "Grade 9",
    "Grade 10", "Grade 11", "Grade 12"
  ];
}

// Map a class grade_level to the teacher grade_band options in your DB
function getBandForGradeLevel(grade_level) {
  if (!grade_level) return null;
  const g = grade_level.toString().trim();

  if (g === "KG1" || g === "KG2") return "KG1 - KG2";

  const m = g.match(/^Grade\s+(\d+)$/i);
  if (!m) return null;

  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;

  if (n >= 1 && n <= 3) return "Grade 1 - Grade 3";
  if (n >= 4 && n <= 8) return "Grade 4 - Grade 8";
  if (n >= 9 && n <= 12) return "Grade 9 - Grade 12";

  return null;
}

// Constant subjects per grade range
function getConstantSubjectNamesForGradeLevel(grade_level) {
  const band = getBandForGradeLevel(grade_level);

  if (band === "KG1 - KG2") {
    return ["Math", "Arabic", "English", "Science", "Art", "Sports"];
  }

  if (band === "Grade 1 - Grade 3" || band === "Grade 4 - Grade 8") {
    return ["Math", "Arabic", "English", "Science", "Art", "Sports", "History"];
  }

  if (band === "Grade 9 - Grade 12") {
    return ["Math", "Arabic", "English", "Art", "Sports", "History", "Biology", "Chemistry", "Physics"];
  }

  return [];
}

module.exports = {

  // ================================
  // List classes (All)
  // ================================
  listClasses: async (req, res) => {
    try {
      const classes = (await ClassModel.getAllClasses()).rows;

      res.render('admin/classes/list_classes', {
        title: "Classes",
        user: req.session.user,
        classes,
        gradeLevels: getAllGradeLevels()
      });
    } catch (err) {
      console.error(err);
      res.send("Error loading classes list.");
    }
  },

  // ================================
  // List classes by grade
  // ================================
  listClassesByGrade: async (req, res) => {
    try {
      const gradeLevelRaw = req.params.gradeLevel || "";
      const gradeLevel = decodeURIComponent(gradeLevelRaw).trim();

      const allowed = getAllGradeLevels();
      if (!allowed.includes(gradeLevel)) {
        return res.status(400).send("Invalid grade level.");
      }

      const classes = (await ClassModel.getClassesByGradeLevel(gradeLevel)).rows;

      return res.render('admin/classes/grade_classes', {
        title: `Classes - ${gradeLevel}`,
        user: req.session.user,
        gradeLevel,
        classes
      });
    } catch (err) {
      console.error("List classes by grade error:", err);
      res.send("Error loading grade classes.");
    }
  },

  // ================================
  // Create class page
  // ================================
  createClassPage: async (req, res) => {
    const gradeLevels = getAllGradeLevels();

    res.render('admin/classes/create_class', {
      title: "Create Class",
      user: req.session.user,
      gradeLevels,
      error: null,
      message: null
    });
  },

  createClass: async (req, res) => {
    try {
      const { grade_level, class_name, office_no } = req.body;
      const gradeLevels = getAllGradeLevels();

      if (!grade_level || !class_name || !office_no) {
        return res.render('admin/classes/create_class', {
          title: "Create Class",
          user: req.session.user,
          gradeLevels,
          error: "Grade level, class name, and office number are required.",
          message: null
        });
      }

      if (!gradeLevels.includes(grade_level)) {
        return res.render('admin/classes/create_class', {
          title: "Create Class",
          user: req.session.user,
          gradeLevels,
          error: "Invalid grade level.",
          message: null
        });
      }

      // ✅ capacity defaults to 30 in DB
      await ClassModel.createClass(grade_level, class_name.trim(), (office_no || '').trim());

      return res.render('admin/classes/create_class', {
        title: "Create Class",
        user: req.session.user,
        gradeLevels,
        error: null,
        message: "Class created successfully! (Capacity: 30 students)"
      });

    } catch (err) {
      console.error(err);
      res.send("Error creating class.");
    }
  },

  // ================================
  // JSON endpoint for eligible teachers for selected subject
  // ================================
  getEligibleTeachersForSubject: async (req, res) => {
    try {
      const classId = req.params.id;
      const subjectId = parseInt(req.query.subject_id, 10);

      if (!subjectId) {
        return res.status(400).json({ ok: false, message: "subject_id is required" });
      }

      const classRes = await ClassModel.getClassById(classId);
      if (!classRes.rows.length) {
        return res.status(404).json({ ok: false, message: "Class not found" });
      }

      const classData = classRes.rows[0];
      const classBand = getBandForGradeLevel(classData.grade_level);

      if (!classBand) {
        return res.status(400).json({ ok: false, message: "Invalid class grade level" });
      }

      const allowedSubjectNames = getConstantSubjectNamesForGradeLevel(classData.grade_level);
      const allowedSubjects = allowedSubjectNames.length
        ? (await pool.query(
            `SELECT id
               FROM subjects
              WHERE subject_name = ANY($1::text[])`,
            [allowedSubjectNames]
          )).rows
        : [];

      const allowedIds = new Set(allowedSubjects.map(r => Number(r.id)));
      if (!allowedIds.has(Number(subjectId))) {
        return res.status(400).json({ ok: false, message: "Subject not allowed for this grade level" });
      }

      const teachers = (await ClassModel.getEligibleTeachersForSubjectAndBand(subjectId, classBand)).rows;

      return res.json({
        ok: true,
        teachers: teachers.map(t => ({
          id: t.id,
          teacher_number: t.teacher_number,
          first_name: t.first_name,
          last_name: t.last_name,
          email: t.email,
          specialization: t.specialization
        }))
      });

    } catch (err) {
      console.error("Eligible teachers endpoint error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  },

  // NEW JSON endpoint for Timetable Teacher Selection
  getEligibleTeachersForTimetable: async (req, res) => {
    try {
      const classId = req.params.id;
      const subjectId = parseInt(req.query.subject_id, 10);

      if (!subjectId) {
        return res.status(400).json({ ok: false, message: "subject_id is required" });
      }

      const classRes = await ClassModel.getClassById(classId);
      if (!classRes.rows.length) {
        return res.status(404).json({ ok: false, message: "Class not found" });
      }

      const classData = classRes.rows[0];
      const classBand = getBandForGradeLevel(classData.grade_level);

      if (!classBand) {
        return res.status(400).json({ ok: false, message: "Invalid class grade level" });
      }
      
      // We don't need to re-validate the subject allowed list since the main form controls that.
      // We just need the eligible teachers based on the subject and the class band.
      const teachers = (await ClassModel.getEligibleTeachersForSubjectAndBand(subjectId, classBand)).rows;

      return res.json({
        ok: true,
        teachers: teachers.map(t => ({
          id: t.id,
          teacher_number: t.teacher_number,
          first_name: t.first_name,
          last_name: t.last_name,
          specialization: t.specialization
        }))
      });

    } catch (err) {
      console.error("Eligible teachers for timetable endpoint error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  },


  // ================================
  // Manage one class
  // ================================
  manageClassPage: async (req, res) => {
    try {
      const classId = req.params.id;
      const message = req.query.message || null;

      const data = await loadManageClassData(classId);
      if (!data) return res.send("Class not found.");

      res.render('admin/classes/manage_class', {
        title: `Manage ${data.classData.grade_level} - ${data.classData.class_name}`,
        user: req.session.user,
        classData: data.classData,
        students: data.students,
        homeroomTeacher: data.homeroomTeacher,
        subjects: data.subjects,
        mergedSubjects: data.mergedSubjects,
        classSubjects: data.classSubjects,
        capacity: data.capacity,
        enrolledCount: data.enrolledCount,
        seatsLeft: data.seatsLeft,
        isFull: data.isFull,
        message
      });

    } catch (err) {
      console.error("Manage class page error:", err);
      res.send("Error loading manage class page.");
    }
  },

  // ================================
  // Assign homeroom teacher (by teacher number)
  // ================================
  assignHomeroomTeacher: async (req, res) => {
    try {
      const classId = req.params.id;
      const teacher_number = (req.body.teacher_number || "").trim();

      if (!teacher_number) {
        return res.redirect(`/admin/classes/${classId}?message=Please enter teacher number`);
      }

      const tRes = await ClassModel.getTeacherByNumber(teacher_number);
      if (!tRes.rows.length) {
        return res.redirect(`/admin/classes/${classId}?message=Teacher not found`);
      }

      await ClassModel.assignHomeroomTeacher(classId, tRes.rows[0].id);
      return res.redirect(`/admin/classes/${classId}?message=Homeroom teacher assigned successfully`);

    } catch (err) {
      console.error("Assign homeroom teacher error:", err);
      res.send("Error assigning homeroom teacher.");
    }
  },

  // ================================
  // ✅ Enroll student in class (MOVE if already enrolled elsewhere) + CAPACITY CHECK
  // ================================
  enrollStudent: async (req, res) => {
    try {
      const classId = parseInt(req.params.id, 10);
      const student_number = (req.body.student_number || "").trim();

      if (!student_number) {
        return res.redirect(`/admin/classes/${classId}?message=Please enter student number`);
      }

      // ✅ Capacity check before update
      const statsRes = await ClassModel.getClassStats(classId);
      const stats = statsRes.rows[0] || {};
      const capacity = Number(stats.capacity || 30);
      const enrolledCount = Number(stats.current_count || 0);

      if (enrolledCount >= capacity) {
        return res.redirect(`/admin/classes/${classId}?message=${encodeURIComponent(`Class is full (max ${capacity} students).`)}`);
      }

      // ✅ fetch class_id to know if already enrolled in another class
      const sRes = await pool.query(
        `SELECT id, class_id
           FROM student_profiles
          WHERE student_number = $1`,
        [student_number]
      );

      if (!sRes.rows.length) {
        return res.redirect(`/admin/classes/${classId}?message=Student not found`);
      }

      const student = sRes.rows[0];

      // Already in same class
      if (student.class_id === classId) {
        return res.redirect(`/admin/classes/${classId}?message=Student already in this class`);
      }

      // Move (or enroll)
      await ClassModel.enrollStudentInClass(student.id, classId);

      const msg = student.class_id
        ? "Student moved to this class successfully"
        : "Student enrolled successfully";

      return res.redirect(`/admin/classes/${classId}?message=${encodeURIComponent(msg)}`);

    } catch (err) {
      console.error("Enroll student error:", err);

      // If DB trigger blocks capacity
      if (err && err.code === '23514') {
        return res.redirect(`/admin/classes/${req.params.id}?message=${encodeURIComponent("Class is full (capacity reached).")}`);
      }

      res.send("Error enrolling student.");
    }
  },

  // ================================
  // Remove student from class
  // ================================
  removeStudent: async (req, res) => {
    try {
      const classId = req.params.id;
      const studentId = req.params.studentId;

      await ClassModel.removeStudentFromClass(studentId);
      return res.redirect(`/admin/classes/${classId}?message=Student removed successfully`);

    } catch (err) {
      console.error("Remove student error:", err);
      res.send("Error removing student.");
    }
  },

  // ================================
  // Assign Subject Teacher to Class
  // ================================
  assignSubjectTeacher: async (req, res) => {
    try {
      const classId = req.params.id;
      const subject_id = parseInt(req.body.subject_id, 10);

      const teacher_id = req.body.teacher_id ? parseInt(req.body.teacher_id, 10) : null;
      const teacher_number = (req.body.teacher_number || "").trim();

      if (!subject_id || (!teacher_id && !teacher_number)) {
        return res.redirect(`/admin/classes/${classId}?message=Please select subject and choose a teacher`);
      }

      const classData = (await ClassModel.getClassById(classId)).rows[0];
      if (!classData) {
        return res.redirect(`/admin/classes/${classId}?message=Class not found`);
      }

      const allowedSubjectNames = getConstantSubjectNamesForGradeLevel(classData.grade_level);

      const allowedSubjects = allowedSubjectNames.length
        ? (await pool.query(
            `SELECT id
               FROM subjects
              WHERE subject_name = ANY($1::text[])`,
            [allowedSubjectNames]
          )).rows
        : [];

      const allowedSubjectIds = new Set(allowedSubjects.map(s => Number(s.id)));
      if (!allowedSubjectIds.has(Number(subject_id))) {
        return res.redirect(`/admin/classes/${classId}?message=This subject is not allowed for this class grade level`);
      }

      let teacher = null;

      if (teacher_id) {
        const tRes = await pool.query(
          `SELECT id, teacher_number, grade_band
             FROM teacher_profiles
            WHERE id = $1`,
          [teacher_id]
        );
        teacher = tRes.rows[0] || null;
      } else {
        const tRes = await ClassModel.getTeacherByNumber(teacher_number);
        teacher = tRes.rows[0] || null;
      }

      if (!teacher) {
        return res.redirect(`/admin/classes/${classId}?message=Teacher not found`);
      }

      const classBand = getBandForGradeLevel(classData.grade_level);
      if (!classBand || teacher.grade_band !== classBand) {
        return res.redirect(`/admin/classes/${classId}?message=Teacher grade band does not match this class`);
      }

      const owns = await pool.query(
        `SELECT 1
           FROM teacher_subjects
          WHERE teacher_id = $1
            AND subject_id = $2
          LIMIT 1`,
        [teacher.id, subject_id]
      );

      if (!owns.rows.length) {
        return res.redirect(`/admin/classes/${classId}?message=Teacher is not specialized in this subject`);
      }

      await ClassModel.assignSubjectTeacher(classId, subject_id, teacher.id);

      return res.redirect(`/admin/classes/${classId}?message=Subject teacher assigned successfully`);

    } catch (err) {
      console.error("Assign subject teacher error:", err);
      return res.send("Error assigning subject teacher.");
    }
  },
  
  // ================================
  // Manage Class Timetable Page (GET)
  // ================================
  manageTimetablePage: async (req, res) => {
    try {
      const classId = req.params.id;
      const data = await loadTimetableData(classId);
      
      if (!data) return res.send("Class not found.");

      const classBand = getBandForGradeLevel(data.classData.grade_level);
      
      // Fetch ALL teachers for the class's grade band initially (filtered by subject later via AJAX)
      let teachers = [];
      if (classBand) {
          teachers = await getTeachersByGradeBand(classBand);
      }
      
      res.render('admin/classes/manage_timetable', {
        title: `Timetable - ${data.classData.grade_level} - ${data.classData.class_name}`,
        user: req.session.user,
        ...data, 
        teachers, // Pass initial list of teachers
        message: req.query.message || null,
        error: req.query.error || null
      });

    } catch (err) {
      console.error("Manage timetable page error:", err);
      res.send("Error loading timetable page.");
    }
  },

  // ================================
  // Add Timetable Entry (POST)
  // ================================
  addTimetableEntry: async (req, res) => {
    const classId = parseInt(req.params.id, 10);
    const { subject_id, teacher_id, day_of_week, start_time, end_time, room_number } = req.body;
    const redirectUrl = `/admin/classes/${classId}/timetable`;

    try {
      if (!subject_id || !day_of_week || !start_time || !end_time) {
        return res.redirect(`${redirectUrl}?error=${encodeURIComponent('Missing required fields.')}`);
      }

      // Teacher ID is now directly from the dropdown (optional/can be null)
      const final_teacher_id = teacher_id && parseInt(teacher_id, 10) > 0 ? parseInt(teacher_id, 10) : null;
      
      await ClassScheduleModel.createScheduleEntry(
        classId,
        parseInt(subject_id, 10),
        final_teacher_id,
        parseInt(day_of_week, 10),
        start_time,
        end_time,
        room_number
      );

      return res.redirect(`${redirectUrl}?message=${encodeURIComponent('Timetable entry created successfully.')}`);

    } catch (err) {
      console.error("Add timetable entry error:", err);
      if (err.code === '23505') { // Unique constraint violation (scheduling conflict)
        return res.redirect(`${redirectUrl}?error=${encodeURIComponent('Scheduling conflict: Class or Teacher is already booked at this time.')}`);
      }
      res.send("Error creating timetable entry.");
    }
  },
  
  // ================================
  // Delete Timetable Entry (POST)
  // ================================
  deleteTimetableEntry: async (req, res) => {
    const classId = req.params.id;
    const entryId = req.params.entryId;
    const redirectUrl = `/admin/classes/${classId}/timetable`;
    
    try {
      await ClassScheduleModel.deleteScheduleEntry(entryId);
      return res.redirect(`${redirectUrl}?message=${encodeURIComponent('Timetable entry deleted.')}`);
    } catch (err) {
      console.error("Delete timetable entry error:", err);
      res.send("Error deleting timetable entry.");
    }
  },

  // ================================
  // Generate Timetable PDF (GET)
  // ================================
  generateTimetablePdf: async (req, res) => {
    const puppeteer = require('puppeteer');
    const classId = req.params.id;

    try {
      const data = await loadTimetableData(classId);
      if (!data) return res.status(404).send("Class not found.");

      const title = `Timetable - ${data.classData.grade_level} - ${data.classData.class_name}`;
      
      // 1. Render EJS template to HTML string (without layout)
      res.render('admin/classes/timetable_pdf', { 
          title: title, 
          user: req.session.user, 
          classData: data.classData,
          scheduleByDay: data.scheduleByDay,
          dayNames: data.dayNames,
          sortedTimes: data.sortedTimes,
          layout: false 
      }, async (err, html) => {
          if (err) {
            console.error("EJS Render Error:", err);
            return res.status(500).send("Error rendering PDF template.");
          }

          // 2. Launch Puppeteer and generate PDF
          let browser;
          try {
            browser = await puppeteer.launch({ 
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: 'new' 
            });
            const page = await browser.newPage();

            await page.setViewport({ width: 1000, height: 1000 });
            await page.setContent(html, { waitUntil: 'networkidle0' });

            const pdfBuffer = await page.pdf({
                format: 'A4',
                landscape: true,
                printBackground: true,
                margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
            });

            await browser.close();

            // 3. Send PDF to the client
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s/g, '_')}.pdf"`);
            res.send(pdfBuffer);

          } catch(e) {
            console.error("Puppeteer/PDF generation error:", e);
            if (browser) await browser.close();
            res.status(500).send("Error generating PDF timetable. Check console for Puppeteer errors.");
          }
      });

    } catch (err) {
      console.error("Generate PDF error (Controller catch):", err);
      res.status(500).send("Error generating PDF timetable.");
    }
  }

};