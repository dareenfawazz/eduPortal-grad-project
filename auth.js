const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// LOGIN PAGE
router.get('/login', (req, res) => {
  res.render('auth/login', {
    title: 'Login',
    user: req.session.user,
    message: ''
  });
});

// REGISTER PAGE
router.get('/register', (req, res) => {
  res.render('auth/register', {
    title: 'Register',
    user: req.session.user,
    message: ''
  });
});

// POST LOGIN
router.post('/login', authController.login);

// POST REGISTER
router.post('/register', authController.register);

// LOGOUT
router.get('/logout', authController.logout);

// FORGOT PASSWORD
router.get('/forgot-password', authController.showForgotPassword);
router.post('/forgot-password', authController.handleForgotPassword);

// RESET PASSWORD
router.get('/reset-password', authController.showResetPassword);
router.post('/reset-password', authController.handleResetPassword);

// WELCOME (AFTER LOGIN)
router.get('/welcome', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');

  res.render('general/welcome', {
    title: 'Welcome',
    user: req.session.user
  });
});

module.exports = router;
