const express = require('express');
const router = express.Router();
const { requireLogin, requireRole } = require('../middleware/authMiddleware');
const teacherController = require('../controllers/teacherController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ===================================
// Multer Configuration (Resources)
// ===================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../public/uploads/resources');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'resource-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Protect all routes
router.use(requireLogin);
router.use(requireRole('teacher'));

// ===================================
// Dashboard & Profile
// ===================================
router.get('/dashboard', teacherController.dashboard);
router.get('/profile/edit', teacherController.showEditProfile);
router.post('/profile/edit', teacherController.updateProfile);

// ===================================
// My Classes & Attendance
// ===================================
router.get('/classes', teacherController.myClasses);
router.get('/classes/:id', teacherController.viewClass);
router.get('/classes/:id/attendance', teacherController.showAttendanceForClass);
router.post('/classes/:id/attendance', teacherController.saveAttendanceForClass);

// ===================================
// Grading System (Direct Assessments)
// ===================================
router.get('/classes/:id/grades', teacherController.classGradesPage);
router.get('/classes/:id/assessments/create', teacherController.createAssessmentPage);
router.post('/classes/:id/assessments/create', teacherController.createAssessment);
router.get('/classes/:id/assessments/:assessmentId/grade', teacherController.gradeAssessmentPage);
router.post('/classes/:id/assessments/:assessmentId/grade', teacherController.saveAssessmentGrades);

// ===================================
// Assignment Management
// ===================================
router.get('/assignments/create', teacherController.createAssignmentPage);
router.post('/assignments/create', teacherController.createAssignment);
router.get('/assignments/manage', teacherController.manageAssignments);
router.get('/assignments/edit/:id', teacherController.editAssignmentPage);
router.post('/assignments/edit/:id', teacherController.updateAssignment);

// ✅ NEW: Delete Assignment (Synchronized with Assessments)
router.post('/assignments/delete/:id', teacherController.deleteAssignment);

// Review Submissions & Grading (Syncs grades to student_assessment_scores)
router.get('/assignments/view/:id', teacherController.viewAssignmentSubmissions);
router.post('/assignments/:assignmentId/grade/:studentId', teacherController.gradeSubmission);

// ===================================
// Resource Sharing System
// ===================================
router.get('/resources/upload', teacherController.uploadResourcePage);
router.post('/resources/upload', upload.single('resourceFile'), teacherController.uploadResource);
router.get('/resources/manage', teacherController.manageResources);
router.post('/resources/delete/:id', teacherController.deleteResource);

// ===================================
// Timetables and PDF Export
// ===================================
router.get('/timetable', teacherController.myTimetable);
router.get('/timetable/pdf', teacherController.generateFullTimetablePdf);
router.get('/classes/:id/timetable/pdf', teacherController.generateTimetablePdf);

// ===================================
// Reports (Attendance & Marks)
// ===================================
router.get('/reports/attendance/class', teacherController.classAttendanceReportPage);
router.get('/reports/attendance/class/pdf', teacherController.classAttendanceReportPdf);
router.get('/reports/marks', teacherController.classMarksReportPage);
router.get('/reports/marks/pdf', teacherController.classMarksReportPdf);

module.exports = router;