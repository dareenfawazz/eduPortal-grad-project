const express = require('express');
const router = express.Router();

const { requireLogin, requireRole } = require('../middleware/authMiddleware');
const adminClassController = require('../controllers/adminClassController');

// List classes
router.get(
  '/',
  requireLogin,
  requireRole('administrator'),
  adminClassController.listClasses
);

// ✅ List classes by grade
router.get(
  '/grade/:gradeLevel',
  requireLogin,
  requireRole('administrator'),
  adminClassController.listClassesByGrade
);

// Create class (GET)
router.get(
  '/create',
  requireLogin,
  requireRole('administrator'),
  adminClassController.createClassPage
);

// Create class (POST)
router.post(
  '/create',
  requireLogin,
  requireRole('administrator'),
  adminClassController.createClass
);

// ✅ Eligible teachers for a subject in manage_class (JSON)
router.get(
  '/:id/eligible-teachers',
  requireLogin,
  requireRole('administrator'),
  adminClassController.getEligibleTeachersForSubject
);

// NEW: Eligible teachers for a subject in manage_timetable (JSON)
router.get(
  '/:id/timetable/eligible-teachers',
  requireLogin,
  requireRole('administrator'),
  adminClassController.getEligibleTeachersForTimetable
);

// Manage class page
router.get(
  '/:id',
  requireLogin,
  requireRole('administrator'),
  adminClassController.manageClassPage
);

// Assign homeroom teacher (by teacher number)
router.post(
  '/:id/assign-homeroom',
  requireLogin,
  requireRole('administrator'),
  adminClassController.assignHomeroomTeacher
);

// Enroll student in class (by student number)
router.post(
  '/:id/enroll-student',
  requireLogin,
  requireRole('administrator'),
  adminClassController.enrollStudent
);

// Remove student from class
router.get(
  '/:id/remove-student/:studentId',
  requireLogin,
  requireRole('administrator'),
  adminClassController.removeStudent
);

// Assign subject teacher to class (teacher_id dropdown)
router.post(
  '/:id/assign-subject-teacher',
  requireLogin,
  requireRole('administrator'),
  adminClassController.assignSubjectTeacher
);

// ===================================
// Timetable Management
// ===================================
// Timetable page (GET)
router.get(
  '/:id/timetable',
  requireLogin,
  requireRole('administrator'),
  adminClassController.manageTimetablePage
);

// Add entry (POST)
router.post(
  '/:id/timetable/add',
  requireLogin,
  requireRole('administrator'),
  adminClassController.addTimetableEntry
);

// Delete entry (POST)
router.post(
  '/:id/timetable/delete/:entryId',
  requireLogin,
  requireRole('administrator'),
  adminClassController.deleteTimetableEntry
);

// Generate PDF route
router.get(
  '/:id/timetable/pdf',
  requireLogin,
  requireRole('administrator'),
  adminClassController.generateTimetablePdf
);

module.exports = router;