const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { requireLogin, requireRole } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ===================================
// Multer Configuration (Student Submissions)
// ===================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Define directory for assignment uploads
        const dir = path.join(__dirname, '../public/uploads/assignments');
        
        // Ensure directory exists
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Unique filename: submission-timestamp-random.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'submission-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Max 5MB per file
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error("Error: Only Images, PDFs, and Word docs are allowed!"));
    }
});

// Apply security middleware to all student routes
router.use(requireLogin);
router.use(requireRole('student'));

// ===================================
// Dashboard & Profile
// ===================================
router.get('/dashboard', studentController.dashboard);
router.get('/profile/edit', studentController.showEditProfile);
router.post('/profile/edit', studentController.updateProfile);

// ===================================
// Academic, Attendance & Resources
// ===================================
// This route now displays both Subject Marks and Teacher Resources
router.get('/subject/:id', studentController.viewSubject);

router.get('/attendance', studentController.viewAttendance);
router.get('/timetable/pdf', studentController.generateTimetablePdf);

// ===================================
// Assignment System
// ===================================

// List all assignments for the student's class
router.get('/assignments', studentController.viewAssignments);

// View individual assignment details
router.get('/assignments/:id', studentController.viewAssignmentDetails);

// Handle file upload and submission
// Note: 'submissionFile' must match the "name" attribute in your student view form
router.post('/assignments/:id/submit', upload.single('submissionFile'), studentController.submitAssignment);

module.exports = router;