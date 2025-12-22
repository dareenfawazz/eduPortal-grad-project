const AdminModel = require('../models/adminModel');
const ClassModel = require('../models/classModel');
const TeacherModel = require('../models/teacherModel');
const SubjectModel = require('../models/subjectModel');
const ParentModel = require('../models/parentModel');
const pool = require('../config/db');
const bcrypt = require('bcrypt');

// ===============================
// Helper functions
// ===============================

async function generateStudentNumber() {
    const year = 2025;
    const prefix = `STU${year}`;

    const result = await pool.query(
        `SELECT student_number
           FROM student_profiles
          WHERE student_number LIKE $1
          ORDER BY student_number DESC
          LIMIT 1`,
        [`${prefix}%`]
    );

    if (!result.rows.length) return `${prefix}0001`;

    const last = result.rows[0].student_number;
    const number = parseInt(last.slice(prefix.length), 10) + 1;

    return prefix + String(number).padStart(4, '0');
}

async function generateTeacherNumber() {
    const year = 2025;
    const prefix = `TCH${year}`;

    const result = await pool.query(
        `SELECT teacher_number
           FROM teacher_profiles
          WHERE teacher_number LIKE $1
          ORDER BY teacher_number DESC
          LIMIT 1`,
        [`${prefix}%`]
    );

    if (!result.rows.length) return `${prefix}0001`;

    const last = result.rows[0].teacher_number;
    const number = parseInt(last.slice(prefix.length), 10) + 1;

    return prefix + String(number).padStart(4, '0');
}

function getStudentGradeLevels() {
    return [
        "KG1", "KG2",
        "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5",
        "Grade 6", "Grade 7", "Grade 8", "Grade 9",
        "Grade 10", "Grade 11", "Grade 12"
    ];
}

function getTeacherGradeBands() {
    return [
        "KG1 - KG2",
        "Grade 1 - Grade 3",
        "Grade 4 - Grade 8",
        "Grade 9 - Grade 12"
    ];
}

function parseStudentNumbers(input) {
    if (!input) return [];
    return [...new Set(
        String(input)
            .split(/[\n,;\s]+/g)
            .map(x => x.trim())
            .filter(x => x.length > 0)
    )];
}

function toInt(val) {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : null;
}

module.exports = {

    // ===============================
    // Admin Dashboard
    // ===============================
    dashboard: async (req, res) => {
        res.render('admin/dashboard', {
            title: "Admin Dashboard",
            user: req.session.user
        });
    },

    // ===============================
    // Academic Term Management
    // ===============================
    manageTermsPage: async (req, res) => {
        try {
            const terms = (await AdminModel.getAllTerms()).rows;
            res.render('admin/terms/index', {
                title: "Academic Terms",
                user: req.session.user,
                terms
            });
        } catch (err) {
            console.error(err);
            res.status(500).send("Error loading terms.");
        }
    },

    activateTerm: async (req, res) => {
        try {
            await AdminModel.setActiveTerm(req.params.id);
            res.redirect('/admin/terms');
        } catch (err) {
            console.error(err);
            res.status(500).send("Error activating term.");
        }
    },

    createTerm: async (req, res) => {
        try {
            const { name, start_date, end_date } = req.body;
            await pool.query(
                `INSERT INTO academic_terms (name, start_date, end_date) VALUES ($1, $2, $3)`,
                [name, start_date, end_date]
            );
            res.redirect('/admin/terms');
        } catch (err) {
            console.error(err);
            res.status(500).send("Error creating term.");
        }
    },

    // ===============================
    // Users Hub Page  (/admin/users)
    // ===============================
    usersMenu: async (req, res) => {
        return res.render('admin/users/index', {
            title: "Manage Users",
            user: req.session.user
        });
    },

    // ===============================
    // Manage Students Page (with search)
    // ===============================
    manageStudentsPage: async (req, res) => {
        try {
            const q = (req.query.q || "").trim();
            const like = `%${q}%`;

            let students;

            if (!q) {
                students = (await AdminModel.getAllStudentsSimple()).rows;
            } else {
                students = (await pool.query(
                    `SELECT
              sp.id, sp.first_name, sp.last_name, sp.student_number,
              sp.grade_level, sp.class_id, sp.email
            FROM student_profiles sp
            WHERE
              (sp.first_name || ' ' || sp.last_name) ILIKE $1
              OR sp.student_number ILIKE $1
              OR sp.email ILIKE $1
            ORDER BY sp.first_name, sp.last_name`,
                    [like]
                )).rows;
            }

            const classes = {};
            const classRows = (await pool.query("SELECT id, grade_level, class_name FROM classes")).rows;
            classRows.forEach(c => classes[c.id] = `${c.grade_level} - ${c.class_name}`);

            return res.render('admin/users/student', {
                title: "Manage Students",
                user: req.session.user,
                students,
                classes,
                q
            });

        } catch (err) {
            console.error("Manage students page error:", err);
            return res.send("Error loading students page.");
        }
    },

    // ===============================
    // Manage Teachers Page (with search)
    // ===============================
    manageTeachersPage: async (req, res) => {
        try {
            const q = (req.query.q || "").trim();
            const like = `%${q}%`;

            let teachers;

            if (!q) {
                teachers = (await TeacherModel.getAllTeachersAdmin()).rows;
            } else {
                teachers = (await pool.query(
                    `SELECT
              tp.id,
              tp.first_name,
              tp.last_name,
              tp.teacher_number,
              tp.phone_number,
              tp.email,
              tp.grade_band,
              COALESCE(string_agg(s.subject_name, ', ' ORDER BY s.subject_name), '') AS subjects
            FROM teacher_profiles tp
            LEFT JOIN teacher_subjects ts ON ts.teacher_id = tp.id
            LEFT JOIN subjects s ON s.id = ts.subject_id
            WHERE
              (tp.first_name || ' ' || tp.last_name) ILIKE $1
              OR tp.teacher_number ILIKE $1
              OR tp.email ILIKE $1
            GROUP BY tp.id
            ORDER BY tp.teacher_number`,
                    [like]
                )).rows;
            }

            return res.render('admin/users/teacher', {
                title: "Manage Teachers",
                user: req.session.user,
                teachers,
                q
            });

        } catch (err) {
            console.error("Manage teachers page error:", err);
            return res.send("Error loading teachers page.");
        }
    },

    // ===============================
    // Manage Parents Page (with search)
    // ===============================
    manageParentsPage: async (req, res) => {
        try {
            const q = (req.query.q || "").trim();
            const like = `%${q}%`;

            let parents;

            if (!q) {
                parents = (await pool.query(
                    `SELECT id, first_name, last_name, email, phone_number
            FROM users
            WHERE user_role = 'parent'
            ORDER BY first_name, last_name`
                )).rows;
            } else {
                parents = (await pool.query(
                    `SELECT id, first_name, last_name, email, phone_number
            FROM users
            WHERE user_role = 'parent'
              AND (
                (first_name || ' ' || last_name) ILIKE $1
                OR email ILIKE $1
              )
            ORDER BY first_name, last_name`,
                    [like]
                )).rows;
            }

            return res.render('admin/users/parent', {
                title: "Manage Parents",
                user: req.session.user,
                parents,
                q
            });

        } catch (err) {
            console.error("Manage parents page error:", err);
            return res.send("Error loading parents page.");
        }
    },

    // ===============================
    // Create STUDENT
    // ===============================
    createStudentPage: async (req, res) => {
        res.render('admin/users/create_student', {
            title: "Create Student",
            user: req.session.user,
            gradeLevels: getStudentGradeLevels(),
            error: null,
            message: null
        });
    },

    createStudent: async (req, res) => {
        try {
            let {
                first_name, last_name, email, password,
                phone_number, parent_name, date_of_birth,
                address, emergency_contact,
                grade_level
            } = req.body;

            if (!first_name || !last_name || !email || !password) {
                return res.render('admin/users/create_student', {
                    title: "Create Student",
                    user: req.session.user,
                    gradeLevels: getStudentGradeLevels(),
                    error: "First name, last name, email and password are required.",
                    message: null
                });
            }

            first_name = first_name.trim();
            last_name = last_name.trim();
            email = email.trim().toLowerCase();
            phone_number = phone_number?.trim() || null;
            parent_name = parent_name?.trim() || null;
            address = address?.trim() || null;
            emergency_contact = emergency_contact?.trim() || null;
            date_of_birth = date_of_birth?.trim() || null;
            grade_level = grade_level?.trim() || null;

            if (grade_level && !getStudentGradeLevels().includes(grade_level)) {
                return res.render('admin/users/create_student', {
                    title: "Create Student",
                    user: req.session.user,
                    gradeLevels: getStudentGradeLevels(),
                    error: "Invalid grade level selected.",
                    message: null
                });
            }

            const exists = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
            if (exists.rows.length) {
                return res.render('admin/users/create_student', {
                    title: "Create Student",
                    user: req.session.user,
                    gradeLevels: getStudentGradeLevels(),
                    error: "This email is already in use.",
                    message: null
                });
            }

            const password_hash = await bcrypt.hash(password, 10);

            const userResult = await pool.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, phone_number, user_role)
          VALUES ($1,$2,$3,$4,$5,'student') RETURNING id`,
                [first_name, last_name, email, password_hash, phone_number]
            );

            const user_id = userResult.rows[0].id;
            const student_number = await generateStudentNumber();

            await pool.query(
                `INSERT INTO student_profiles
            (user_id, student_number, first_name, last_name, parent_name,
             phone_number, email, date_of_birth, address, emergency_contact, grade_level)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                    user_id, student_number,
                    first_name, last_name, parent_name,
                    phone_number, email, date_of_birth,
                    address, emergency_contact,
                    grade_level
                ]
            );

            res.render('admin/users/create_student', {
                title: "Create Student",
                user: req.session.user,
                gradeLevels: getStudentGradeLevels(),
                error: null,
                message: `Student created successfully. Student number: ${student_number}`
            });

        } catch (err) {
            console.error("Create student error:", err);
            res.render('admin/users/create_student', {
                title: "Create Student",
                user: req.session.user,
                gradeLevels: getStudentGradeLevels(),
                error: "Error creating student: " + err.message,
                message: null
            });
        }
    },

    // ===============================
    // Create PARENT
    // ===============================
    createParentPage: async (req, res) => {
        res.render('admin/users/create_parent', {
            title: "Create Parent",
            user: req.session.user,
            error: null,
            message: null
        });
    },

    createParent: async (req, res) => {
        try {
            let {
                first_name, last_name, email, password,
                phone_number, student_numbers
            } = req.body;

            if (!first_name || !last_name || !email || !password) {
                return res.render('admin/users/create_parent', {
                    title: "Create Parent",
                    user: req.session.user,
                    error: "First name, last name, email and password are required.",
                    message: null
                });
            }

            first_name = first_name.trim();
            last_name = last_name.trim();
            email = email.trim().toLowerCase();
            phone_number = phone_number?.trim() || null;

            student_numbers = Array.isArray(student_numbers)
                ? student_numbers.filter(n => n.trim() !== "")
                : [];

            const exists = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
            if (exists.rows.length) {
                return res.render('admin/users/create_parent', {
                    title: "Create Parent",
                    user: req.session.user,
                    error: "Email already in use.",
                    message: null
                });
            }

            const password_hash = await bcrypt.hash(password, 10);

            const parentResult = await pool.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, phone_number, user_role)
          VALUES ($1,$2,$3,$4,$5,'parent') RETURNING id`,
                [first_name, last_name, email, password_hash, phone_number]
            );

            const parent_id = parentResult.rows[0].id;
            const parentFullName = `${first_name} ${last_name}`;

            for (const stuNum of student_numbers) {
                const s = await pool.query(
                    `SELECT id FROM student_profiles WHERE student_number=$1`,
                    [stuNum.trim()]
                );

                if (!s.rows.length) continue;

                const student_id = s.rows[0].id;

                await AdminModel.linkParentToStudent(parent_id, student_id);

                await pool.query(
                    `UPDATE student_profiles SET parent_name=$1 WHERE id=$2`,
                    [parentFullName, student_id]
                );
            }

            return res.render('admin/users/create_parent', {
                title: "Create Parent",
                user: req.session.user,
                error: null,
                message: "Parent created and children linked (if valid numbers were provided)."
            });

        } catch (err) {
            console.error("Create parent error:", err);
            res.render('admin/users/create_parent', {
                title: "Create Parent",
                user: req.session.user,
                error: "Error creating parent: " + err.message,
                message: null
            });
        }
    },

    // ===============================
    // Edit Parent Page
    // ===============================
    editParentPage: async (req, res) => {
        try {
            const parentId = req.params.id;

            const parentResult = await AdminModel.getParentById(parentId);
            if (!parentResult.rows.length) return res.send("Parent not found.");

            const parent = parentResult.rows[0];

            const children = (await ParentModel.getChildrenByParentId(parentId)).rows;

            return res.render('admin/users/edit_parent', {
                title: "Edit Parent",
                user: req.session.user,
                parent,
                children,
                message: null,
                error: null
            });

        } catch (err) {
            console.error("Edit parent page error:", err);
            return res.send("Error loading edit parent page.");
        }
    },

    // ===============================
    // Update Parent + Manage Children
    // ===============================
    updateParentByAdmin: async (req, res) => {
        try {
            const parentId = req.params.id;

            const parentResult = await AdminModel.getParentById(parentId);
            if (!parentResult.rows.length) return res.send("Parent not found.");

            let { first_name, last_name, email, phone_number, add_student_numbers, remove_student_ids } = req.body;

            if (!first_name || !last_name || !email) {
                const parent = parentResult.rows[0];
                const children = (await ParentModel.getChildrenByParentId(parentId)).rows;

                return res.render('admin/users/edit_parent', {
                    title: "Edit Parent",
                    user: req.session.user,
                    parent,
                    children,
                    message: null,
                    error: "First name, last name, and email are required."
                });
            }

            first_name = first_name.trim();
            last_name = last_name.trim();
            email = email.trim().toLowerCase();
            phone_number = phone_number?.trim() || null;

            const exists = await pool.query(
                `SELECT id FROM users WHERE email=$1 AND id <> $2`,
                [email, parentId]
            );
            if (exists.rows.length) {
                const parent = parentResult.rows[0];
                const children = (await ParentModel.getChildrenByParentId(parentId)).rows;

                return res.render('admin/users/edit_parent', {
                    title: "Edit Parent",
                    user: req.session.user,
                    parent,
                    children,
                    message: null,
                    error: "This email is already used by another user."
                });
            }

            await pool.query(
                `UPDATE users
            SET first_name=$1,
                last_name=$2,
                email=$3,
                phone_number=$4
          WHERE id=$5 AND user_role='parent'`,
                [first_name, last_name, email, phone_number, parentId]
            );

            const parentFullName = `${first_name} ${last_name}`;

            let removedCount = 0;

            const removeIds = Array.isArray(remove_student_ids)
                ? remove_student_ids.map(toInt).filter(Boolean)
                : (remove_student_ids ? [toInt(remove_student_ids)].filter(Boolean) : []);

            for (const studentId of removeIds) {
                await AdminModel.unlinkParentFromStudent(parentId, studentId);
                removedCount++;

                const stillLinked = await pool.query(
                    `SELECT 1 FROM parent_children WHERE student_id=$1 LIMIT 1`,
                    [studentId]
                );
                if (!stillLinked.rows.length) {
                    await pool.query(
                        `UPDATE student_profiles SET parent_name = NULL WHERE id=$1`,
                        [studentId]
                    );
                }
            }

            const numbersToAdd = parseStudentNumbers(add_student_numbers);
            const invalidNumbers = [];
            let addedCount = 0;

            for (const stuNum of numbersToAdd) {
                const s = await pool.query(
                    `SELECT id FROM student_profiles WHERE student_number=$1 LIMIT 1`,
                    [stuNum]
                );

                if (!s.rows.length) {
                    invalidNumbers.push(stuNum);
                    continue;
                }

                const studentId = s.rows[0].id;

                await AdminModel.linkParentToStudent(parentId, studentId);

                await pool.query(
                    `UPDATE student_profiles SET parent_name=$1 WHERE id=$2`,
                    [parentFullName, studentId]
                );

                addedCount++;
            }

            const updatedParent = (await AdminModel.getParentById(parentId)).rows[0];
            const children = (await ParentModel.getChildrenByParentId(parentId)).rows;

            let message = "Parent updated successfully.";
            if (addedCount > 0) message += ` Added ${addedCount} child(ren).`;
            if (removedCount > 0) message += ` Removed ${removedCount} child(ren).`;
            if (invalidNumbers.length > 0) message += ` Invalid student numbers: ${invalidNumbers.join(', ')}`;

            return res.render('admin/users/edit_parent', {
                title: "Edit Parent",
                user: req.session.user,
                parent: updatedParent,
                children,
                message,
                error: null
            });

        } catch (err) {
            console.error("Update parent error:", err);

            const parentId = req.params.id;
            const parentResult = await AdminModel.getParentById(parentId);
            const parent = parentResult.rows[0] || { id: parentId };
            const children = (await ParentModel.getChildrenByParentId(parentId)).rows;

            return res.render('admin/users/edit_parent', {
                title: "Edit Parent",
                user: req.session.user,
                parent,
                children,
                message: null,
                error: "Error updating parent: " + err.message
            });
        }
    },

    // ===============================
    // Create TEACHER
    // ===============================
    createTeacherPage: async (req, res) => {
        try {
            const subjects = (await SubjectModel.getAllSubjects()).rows;

            res.render('admin/users/create_teacher', {
                title: "Create Teacher",
                user: req.session.user,
                subjects,
                gradeBands: getTeacherGradeBands(),
                error: null,
                message: null
            });
        } catch (err) {
            console.error("Create teacher page error:", err);
            res.send("Error loading create teacher page.");
        }
    },

    createTeacher: async (req, res) => {
        try {
            let {
                first_name, last_name, email, password,
                phone_number,
                grade_band,
                subject_ids
            } = req.body;

            const subjects = (await SubjectModel.getAllSubjects()).rows;

            if (!first_name || !last_name || !email || !password) {
                return res.render('admin/users/create_teacher', {
                    title: "Create Teacher",
                    user: req.session.user,
                    subjects,
                    gradeBands: getTeacherGradeBands(),
                    error: "First name, last name, email and password are required.",
                    message: null
                });
            }

            first_name = first_name.trim();
            last_name = last_name.trim();
            email = email.toLowerCase().trim();
            phone_number = phone_number?.trim() || null;

            grade_band = grade_band?.trim() || null;
            if (!grade_band || !getTeacherGradeBands().includes(grade_band)) {
                return res.render('admin/users/create_teacher', {
                    title: "Create Teacher",
                    user: req.session.user,
                    subjects,
                    gradeBands: getTeacherGradeBands(),
                    error: "Grade band is required (please select a valid option).",
                    message: null
                });
            }

            let subjectIds = [];
            if (Array.isArray(subject_ids)) subjectIds = subject_ids;
            else if (typeof subject_ids === 'string' && subject_ids.trim() !== '') subjectIds = [subject_ids];

            subjectIds = [...new Set(subjectIds.map(x => parseInt(x, 10)).filter(n => Number.isInteger(n)))];

            if (subjectIds.length === 0) {
                return res.render('admin/users/create_teacher', {
                    title: "Create Teacher",
                    user: req.session.user,
                    subjects,
                    gradeBands: getTeacherGradeBands(),
                    error: "Please select at least one speciality subject for the teacher.",
                    message: null
                });
            }

            const exists = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
            if (exists.rows.length) {
                return res.render('admin/users/create_teacher', {
                    title: "Create Teacher",
                    user: req.session.user,
                    subjects,
                    gradeBands: getTeacherGradeBands(),
                    error: "Email already in use.",
                    message: null
                });
            }

            const password_hash = await bcrypt.hash(password, 10);

            const userResult = await pool.query(
                `INSERT INTO users
            (first_name, last_name, email, password_hash, phone_number, user_role)
          VALUES ($1,$2,$3,$4,$5,'teacher')
          RETURNING id`,
                [first_name, last_name, email, password_hash, phone_number]
            );

            const user_id = userResult.rows[0].id;
            const teacher_number = await generateTeacherNumber();

            const subjectNameRows = await pool.query(
                `SELECT subject_name FROM subjects WHERE id = ANY($1::int[]) ORDER BY subject_name`,
                [subjectIds]
            );
            const specializationText = subjectNameRows.rows.map(r => r.subject_name).join(', ');

            const teacherProfileResult = await pool.query(
                `INSERT INTO teacher_profiles
            (user_id, teacher_number, first_name, last_name, specialization, grade_band, phone_number, email)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING id`,
                [
                    user_id, teacher_number,
                    first_name, last_name,
                    specializationText || null,
                    grade_band,
                    phone_number,
                    email
                ]
            );

            const teacher_profile_id = teacherProfileResult.rows[0].id;

            await TeacherModel.setTeacherSubjects(teacher_profile_id, subjectIds);

            res.render('admin/users/create_teacher', {
                title: "Create Teacher",
                user: req.session.user,
                subjects: (await SubjectModel.getAllSubjects()).rows,
                gradeBands: getTeacherGradeBands(),
                error: null,
                message: `Teacher created successfully. Teacher number: ${teacher_number}`
            });

        } catch (err) {
            console.error("Create teacher error:", err);
            const subjects = (await SubjectModel.getAllSubjects()).rows;
            res.render('admin/users/create_teacher', {
                title: "Create Teacher",
                user: req.session.user,
                subjects,
                gradeBands: getTeacherGradeBands(),
                error: "Error creating teacher: " + err.message,
                message: null
            });
        }
    },

    // ====================================================
    // Edit Teacher Page
    // ====================================================
    editTeacherPage: async (req, res) => {
        try {
            const teacherId = req.params.id;

            const teacherResult = await TeacherModel.getTeacherProfileById(teacherId);
            if (!teacherResult.rows.length) return res.send("Teacher not found.");

            const teacher = teacherResult.rows[0];
            const subjects = (await SubjectModel.getAllSubjects()).rows;
            const selectedSubjects = (await TeacherModel.getTeacherSubjects(teacherId)).rows.map(r => r.subject_id);

            res.render('admin/users/edit_teacher', {
                title: "Edit Teacher",
                user: req.session.user,
                teacher,
                subjects,
                selectedSubjects,
                gradeBands: getTeacherGradeBands(), // ✅ NEW
                message: null,
                error: null
            });

        } catch (err) {
            console.error("Edit teacher page error:", err);
            res.send("Error loading edit teacher page.");
        }
    },

    updateTeacherByAdmin: async (req, res) => {
        try {
            const teacherId = req.params.id;

            let { phone_number, specialization, grade_band, subject_ids } = req.body; // ✅ NEW: grade_band

            phone_number = phone_number?.trim() || null;
            specialization = specialization?.trim() || null;
            grade_band = grade_band?.trim() || null;

            // ✅ Validate grade_band
            if (!grade_band || !getTeacherGradeBands().includes(grade_band)) {
                const teacherResult = await TeacherModel.getTeacherProfileById(teacherId);
                const teacher = teacherResult.rows[0];
                const subjects = (await SubjectModel.getAllSubjects()).rows;
                const selectedSubjects = (await TeacherModel.getTeacherSubjects(teacherId)).rows.map(r => r.subject_id);

                return res.render('admin/users/edit_teacher', {
                    title: "Edit Teacher",
                    user: req.session.user,
                    teacher,
                    subjects,
                    selectedSubjects,
                    gradeBands: getTeacherGradeBands(),
                    message: null,
                    error: "Please select a valid grade level band."
                });
            }

            let subjectIds = [];
            if (Array.isArray(subject_ids)) subjectIds = subject_ids;
            else if (typeof subject_ids === 'string' && subject_ids.trim() !== '') subjectIds = [subject_ids];

            subjectIds = [...new Set(subjectIds.map(x => parseInt(x, 10)).filter(n => Number.isInteger(n)))];

            if (subjectIds.length === 0) {
                const teacherResult = await TeacherModel.getTeacherProfileById(teacherId);
                const teacher = teacherResult.rows[0];
                const subjects = (await SubjectModel.getAllSubjects()).rows;

                return res.render('admin/users/edit_teacher', {
                    title: "Edit Teacher",
                    user: req.session.user,
                    teacher,
                    subjects,
                    selectedSubjects: [],
                    gradeBands: getTeacherGradeBands(),
                    message: null,
                    error: "Please select at least one speciality subject."
                });
            }

            // ✅ Update teacher (now includes grade_band)
            await TeacherModel.updateTeacherProfileById(teacherId, specialization, phone_number, grade_band);
            await TeacherModel.setTeacherSubjects(teacherId, subjectIds);

            const teacherResult = await TeacherModel.getTeacherProfileById(teacherId);
            const teacher = teacherResult.rows[0];
            const subjects = (await SubjectModel.getAllSubjects()).rows;
            const selectedSubjects = (await TeacherModel.getTeacherSubjects(teacherId)).rows.map(r => r.subject_id);

            return res.render('admin/users/edit_teacher', {
                title: "Edit Teacher",
                user: req.session.user,
                teacher,
                subjects,
                selectedSubjects,
                gradeBands: getTeacherGradeBands(),
                message: "Teacher updated successfully!",
                error: null
            });

        } catch (err) {
            console.error("Update teacher error:", err);
            res.send("Error updating teacher.");
        }
    },

    // ====================================================
    // Edit Student Page
    // ====================================================
    editStudentPage: async (req, res) => {
        try {
            const studentId = req.params.id;

            const result = await pool.query(
                `SELECT sp.*, to_char(sp.date_of_birth,'YYYY-MM-DD') AS date_of_birth,
                c.class_name
            FROM student_profiles sp
            LEFT JOIN classes c ON sp.class_id = c.id
           WHERE sp.id = $1`,
                [studentId]
            );

            if (!result.rows.length) return res.send("Student not found.");

            const student = result.rows[0];
            const gradeLevels = getStudentGradeLevels();
            const classList = (await ClassModel.getAllClasses()).rows;

            res.render('admin/users/edit_student', {
                title: "Edit Student",
                user: req.session.user,
                student,
                gradeLevels,
                classList,
                message: null
            });

        } catch (err) {
            console.error("Edit student error:", err);
            res.send("Error loading page.");
        }
    },

    updateStudentByAdmin: async (req, res) => {
        try {
            const studentId = req.params.id;

            let { grade_level, class_id, phone_number, address, emergency_contact } = req.body;

            phone_number = phone_number?.trim() || null;
            address = address?.trim() || null;
            emergency_contact = emergency_contact?.trim() || null;

            grade_level = grade_level?.trim() || null;
            if (grade_level && !getStudentGradeLevels().includes(grade_level)) grade_level = null;

            await pool.query(
                `UPDATE student_profiles
             SET grade_level=$1,
                 class_id=$2,
                 phone_number=$3,
                 address=$4,
                 emergency_contact=$5
           WHERE id=$6`,
                [grade_level || null, class_id || null, phone_number, address, emergency_contact, studentId]
            );

            return res.redirect(`/admin/users/edit-student/${studentId}`);
        } catch (err) {
            console.error("Update student error:", err);
            res.send("Error updating student.");
        }
    }

};