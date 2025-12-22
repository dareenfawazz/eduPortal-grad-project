const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const PasswordResetModel = require('../models/passwordResetModel');

// Generate student number - fixed year 2025
async function generateStudentNumber() {
  const year = 2025;

  const result = await pool.query(
    `SELECT student_number FROM student_profiles 
     WHERE student_number LIKE $1 
     ORDER BY student_number DESC LIMIT 1`,
    [`STU${year}%`]
  );

  if (result.rows.length === 0) return `STU${year}0001`;

  const lastNumber = parseInt(result.rows[0].student_number.slice(7));
  return `STU${year}${String(lastNumber + 1).padStart(4, '0')}`;
}

// Generate teacher number - fixed 2025
async function generateTeacherNumber() {
  const year = 2025;

  const result = await pool.query(
    `SELECT teacher_number FROM teacher_profiles 
     WHERE teacher_number LIKE $1 
     ORDER BY teacher_number DESC LIMIT 1`,
    [`TEA${year}%`]
  );

  if (result.rows.length === 0) return `TEA${year}0001`;

  const lastNumber = parseInt(result.rows[0].teacher_number.slice(7));
  return `TEA${year}${String(lastNumber + 1).padStart(4, '0')}`;
}

// Helpers for password reset
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function getAppUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function tokenExpiryDate() {
  const mins = parseInt(process.env.PASSWORD_RESET_TOKEN_MINUTES || '30', 10);
  return new Date(Date.now() + mins * 60 * 1000);
}

module.exports = {
  // ============================
  // REGISTER
  // ============================
  register: async (req, res) => {
    const { first_name, last_name, email, password, phone_number, user_role } = req.body;

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const userResult = await pool.query(
        `INSERT INTO users (first_name, last_name, email, password_hash, phone_number, user_role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [first_name, last_name, email.toLowerCase(), hashedPassword, phone_number || null, user_role]
      );

      const user_id = userResult.rows[0].id;

      // Student profile
      if (user_role === "student") {
        const student_number = await generateStudentNumber();

        await pool.query(
          `INSERT INTO student_profiles 
           (user_id, student_number, first_name, last_name, parent_name, phone_number, email, date_of_birth)
           VALUES ($1, $2, $3, $4, NULL, $5, $6, NULL)`,
          [user_id, student_number, first_name, last_name, phone_number || null, email.toLowerCase()]
        );
      }

      // Teacher profile
      if (user_role === "teacher") {
        const teacher_number = await generateTeacherNumber();

        await pool.query(
          `INSERT INTO teacher_profiles 
           (user_id, teacher_number, first_name, last_name, specialization, phone_number, email)
           VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
          [user_id, teacher_number, first_name, last_name, phone_number || null, email.toLowerCase()]
        );
      }

      res.redirect('/auth/login');

    } catch (err) {
      console.error("Registration Error:", err);
      res.render('auth/register', {
        title: "Register",
        message: "Error: " + err.message,
        user: null
      });
    }
  },

  // ============================
  // LOGIN
  // ============================
  login: async (req, res) => {
    const { email, password } = req.body;

    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE email = $1",
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return res.render('auth/login', {
          title: "Login",
          message: "User not found",
          user: null
        });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return res.render('auth/login', {
          title: "Login",
          message: "Incorrect password",
          user: null
        });
      }

      // Save user in session
      req.session.user = user;

      // Initialize activity timestamp for idle-timeout middleware
      req.session.lastActivity = Date.now();

      // Redirect ALL USERS to welcome page
      return res.redirect('/welcome');

    } catch (err) {
      console.error("Login Error:", err);
      res.render('auth/login', {
        title: "Login",
        message: "Error: " + err.message,
        user: null
      });
    }
  },

  // ============================
  // LOGOUT
  // ============================
  logout: (req, res) => {
    req.session.destroy(() => {
      res.redirect('/auth/login');
    });
  },

  // ============================
  // FORGOT PASSWORD (FR-4)
  // ============================
  showForgotPassword: (req, res) => {
    res.render('auth/forgot_password', {
      title: 'Forgot Password',
      user: req.session.user || null,
      message: ''
    });
  },

  handleForgotPassword: async (req, res) => {
    const { email } = req.body;

    try {
      // Neutral message (prevents email enumeration)
      const neutralMessage =
        'If this email exists, a reset link has been generated. Check the server console (dev mode).';

      const userResult = await pool.query(
        'SELECT id, email FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        return res.render('auth/forgot_password', {
          title: 'Forgot Password',
          user: req.session.user || null,
          message: neutralMessage
        });
      }

      const user = userResult.rows[0];

      // Invalidate previous unused tokens for this user (clean)
      await PasswordResetModel.invalidateAllForUser(user.id);

      // Create raw token (send raw; store hashed)
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = sha256(rawToken);
      const expiresAt = tokenExpiryDate();

      await PasswordResetModel.createToken(user.id, tokenHash, expiresAt);

      const resetLink = `${getAppUrl(req)}/auth/reset-password?token=${rawToken}`;

      // DEV delivery: log to console
      console.log('PASSWORD RESET LINK:', resetLink);

      return res.render('auth/forgot_password', {
        title: 'Forgot Password',
        user: req.session.user || null,
        message: neutralMessage
      });

    } catch (err) {
      console.error("Forgot Password Error:", err);
      return res.render('auth/forgot_password', {
        title: 'Forgot Password',
        user: req.session.user || null,
        message: "Error: " + err.message
      });
    }
  },

  // ============================
  // RESET PASSWORD (FR-4)
  // ============================
  showResetPassword: (req, res) => {
    const { token } = req.query;

    res.render('auth/reset_password', {
      title: 'Reset Password',
      user: req.session.user || null,
      message: '',
      token: token || ''
    });
  },

  handleResetPassword: async (req, res) => {
    const { token, new_password, confirm_password } = req.body;

    try {
      if (!token) {
        return res.render('auth/reset_password', {
          title: 'Reset Password',
          user: req.session.user || null,
          message: 'Missing token.',
          token: ''
        });
      }

      if (!new_password || new_password.length < 6) {
        return res.render('auth/reset_password', {
          title: 'Reset Password',
          user: req.session.user || null,
          message: 'Password must be at least 6 characters.',
          token
        });
      }

      if (new_password !== confirm_password) {
        return res.render('auth/reset_password', {
          title: 'Reset Password',
          user: req.session.user || null,
          message: 'Passwords do not match.',
          token
        });
      }

      const tokenHash = sha256(token);
      const record = await PasswordResetModel.findValidToken(tokenHash);

      if (!record) {
        return res.render('auth/reset_password', {
          title: 'Reset Password',
          user: req.session.user || null,
          message: 'Token is invalid or expired.',
          token
        });
      }

      const hashedPassword = await bcrypt.hash(new_password, 10);

      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [hashedPassword, record.user_id]
      );

      await PasswordResetModel.markUsed(record.id);

      return res.redirect('/auth/login');

    } catch (err) {
      console.error("Reset Password Error:", err);
      return res.render('auth/reset_password', {
        title: 'Reset Password',
        user: req.session.user || null,
        message: "Error: " + err.message,
        token
      });
    }
  }
};
