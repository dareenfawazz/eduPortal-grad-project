const pool = require('../config/db');
const puppeteer = require('puppeteer');
const ClassModel = require('../models/classModel');
const AttendanceModel = require('../models/attendanceModel');
const AdminModel = require('../models/adminModel');

function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  // --- Attendance Reports ---
  classAttendanceReportPage: async (req, res) => {
    try {
      const classes = (await ClassModel.getAllClasses()).rows;
      const classId = toInt(req.query.class_id);
      let selectedClass = null; let reportRows = null;
      if (classId) {
        selectedClass = (await pool.query(`SELECT * FROM classes WHERE id = $1`, [classId])).rows[0];
        if (selectedClass) reportRows = await AttendanceModel.getClassAttendanceReport(classId);
      }
      res.render('admin/reports/attendance_class', { title: 'Class Attendance', user: req.session.user, classes, selectedClass, reportRows, classId, error: null });
    } catch (err) { res.status(500).send('Error loading attendance page'); }
  },

  classAttendanceReportPdf: async (req, res) => {
    try {
      const classId = toInt(req.query.class_id);
      const selectedClass = (await pool.query(`SELECT * FROM classes WHERE id = $1`, [classId])).rows[0];
      const reportRows = await AttendanceModel.getClassAttendanceReport(classId);
      res.render('admin/reports/attendance_class_pdf', { selectedClass, reportRows, layout: false }, async (err, html) => {
        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html);
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        await browser.close();
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { res.status(500).send('Error generating attendance PDF'); }
  },

  studentAttendanceReportPage: async (req, res) => {
    try {
      const studentNumber = (req.query.student_number || '').trim().toUpperCase();
      let student = null; let report = null; let error = null;
      if (studentNumber) {
        const studentRes = await AttendanceModel.getStudentProfileByStudentNumber(studentNumber);
        student = studentRes?.rows?.[0];
        if (!student) error = 'Student not found';
        else report = await AttendanceModel.getAttendanceReport(student.id);
      }
      res.render('admin/reports/attendance_student', { title: 'Student Attendance', user: req.session.user, studentNumber, student, report, error });
    } catch (err) { res.status(500).send('Error loading student attendance'); }
  },

  // --- Grade Reports ---
  classGradesReportPage: async (req, res) => {
    try {
      const classes = (await ClassModel.getAllClasses()).rows;
      const classId = toInt(req.query.class_id);
      let selectedClass = null; let gradeData = null;
      if (classId) {
        selectedClass = classes.find(c => c.id === classId);
        gradeData = (await AdminModel.getClassGradesSummary(classId)).rows;
      }
      res.render('admin/reports/grades_class', { title: 'Class Grades Summary', user: req.session.user, classes, selectedClass, gradeData, classId });
    } catch (err) { res.status(500).send("Error loading grades report."); }
  },

  studentReportCardPage: async (req, res) => {
    try {
      const studentNumber = (req.query.student_number || '').trim().toUpperCase();
      let student = null; let reportData = null;
      if (studentNumber) {
        const studentRes = await pool.query(`SELECT * FROM student_profiles WHERE student_number = $1`, [studentNumber]);
        student = studentRes.rows[0];
        if (student) reportData = (await AdminModel.getStudentFullReport(student.id)).rows;
      }
      res.render('admin/reports/report_card_student', { title: 'Student Report Card', user: req.session.user, student, reportData, studentNumber });
    } catch (err) { res.status(500).send("Error loading report card."); }
  },

  studentReportCardPdf: async (req, res) => {
    try {
      const studentId = req.params.id;
      const student = (await pool.query(`SELECT sp.*, c.class_name, c.grade_level FROM student_profiles sp JOIN classes c ON sp.class_id = c.id WHERE sp.id = $1`, [studentId])).rows[0];
      const reportData = (await AdminModel.getStudentFullReport(studentId)).rows;
      res.render('admin/reports/pdf_report_card', { student, reportData, layout: false }, async (err, html) => {
        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html);
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { res.status(500).send("Error generating PDF."); }
  },

  bulkClassReportCardsPdf: async (req, res) => {
    try {
      const classId = toInt(req.params.classId);
      const classRes = await pool.query(`SELECT * FROM classes WHERE id = $1`, [classId]);
      const classData = classRes.rows[0];
      const studentsRes = await pool.query(`SELECT id, first_name, last_name, student_number FROM student_profiles WHERE class_id = $1 ORDER BY first_name`, [classId]);
      const fullClassData = await Promise.all(studentsRes.rows.map(async (s) => {
        const grades = await AdminModel.getStudentFullReport(s.id);
        return { ...s, grades: grades.rows };
      }));
      res.render('admin/reports/pdf_bulk_report_cards', { classData, fullClassData, layout: false }, async (err, html) => {
        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html);
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm' } });
        await browser.close();
        res.setHeader('Content-Disposition', `attachment; filename="Bulk_Reports_${classData.class_name}.pdf"`);
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { res.status(500).send("Error generating bulk reports"); }
  },

  // ✅ Final: Class Performance Analytics (Benchmarks + Matrix)
  generateClassPerformancePdf: async (req, res) => {
    try {
      const classId = toInt(req.params.classId);
      const classData = (await pool.query(`SELECT * FROM classes WHERE id = $1`, [classId])).rows[0];
      const averages = (await AdminModel.getClassPerformanceData(classId)).rows;
      const studentMatrixData = (await AdminModel.getClassGradesSummary(classId)).rows;

      const subjects = [...new Set(studentMatrixData.map(m => m.subject_name))];
      const students = {};
      studentMatrixData.forEach(row => {
        const name = `${row.first_name} ${row.last_name}`;
        if (!students[name]) students[name] = { id: row.student_number, grades: {} };
        students[name].grades[row.subject_name] = row.weighted_score;
      });

      res.render('admin/reports/pdf_class_performance', { classData, subjectAverages: averages, subjects, students, layout: false }, async (err, html) => {
        const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html);
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        await browser.close();
        res.setHeader('Content-Disposition', `attachment; filename="Performance_${classData.class_name}.pdf"`);
        res.contentType('application/pdf').send(pdf);
      });
    } catch (err) { res.status(500).send("Error generating performance report"); }
  }
};