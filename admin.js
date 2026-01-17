const express = require('express');
const router = express.Router();
const { requireLogin, requireRole } = require('../middleware/authMiddleware');
const adminController = require('../controllers/adminController');
const adminReportController = require('../controllers/adminReportController');

// Middleware for all admin routes
router.use(requireLogin);
router.use(requireRole('administrator'));

// --- Dashboard & Menus ---
router.get('/dashboard', adminController.dashboard);
router.get('/users', adminController.usersMenu);

// --- Academic Term Management ---
// Allows the admin to define academic periods and switch the active term
router.get('/terms', adminController.manageTermsPage);
router.post('/terms/create', adminController.createTerm);
router.post('/terms/activate/:id', adminController.activateTerm);

// --- Manage Students ---
router.get('/users/students', adminController.manageStudentsPage);
router.get('/users/create-student', adminController.createStudentPage);
router.post('/users/create-student', adminController.createStudent);
router.get('/users/edit-student/:id', adminController.editStudentPage);
router.post('/users/edit-student/:id', adminController.updateStudentByAdmin);

// --- Manage Teachers ---
router.get('/users/teachers', adminController.manageTeachersPage);
router.get('/users/create-teacher', adminController.createTeacherPage);
router.post('/users/create-teacher', adminController.createTeacher);
router.get('/users/edit-teacher/:id', adminController.editTeacherPage);
router.post('/users/edit-teacher/:id', adminController.updateTeacherByAdmin);

// --- Manage Parents ---
router.get('/users/parents', adminController.manageParentsPage);
router.get('/users/create-parent', adminController.createParentPage);
router.post('/users/create-parent', adminController.createParent);
router.get('/users/edit-parent/:id', adminController.editParentPage);
router.post('/users/edit-parent/:id', adminController.updateParentByAdmin);

// --- Attendance Reports ---
router.get('/reports/attendance/class', adminReportController.classAttendanceReportPage);
router.get('/reports/attendance/class/pdf', adminReportController.classAttendanceReportPdf);
router.get('/reports/attendance/student', adminReportController.studentAttendanceReportPage);

// --- Grade Reports ---
// Routes are designed to filter data automatically based on the Active Term defined above
router.get('/reports/grades/class', adminReportController.classGradesReportPage);
router.get('/reports/grades/student', adminReportController.studentReportCardPage);
router.get('/reports/grades/student/pdf/:id', adminReportController.studentReportCardPdf);

// --- Bulk & Analytics Reports ---
// Generates landscape class-wide performance matrices or multi-page PDF report card batches
router.get('/reports/grades/class/bulk-pdf/:classId', adminReportController.bulkClassReportCardsPdf);
router.get('/reports/grades/class/performance-pdf/:classId', adminReportController.generateClassPerformancePdf);

module.exports = router;