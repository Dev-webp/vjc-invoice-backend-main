// ─── routes/auth.js ─────────────────────────────────────────
const express    = require("express");
const router     = express.Router();
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const JWT_SECRET = process.env.JWT_SECRET || "vjc_invoice_secret_2024";
module.exports = (db) => {

  // ── Create users table on startup (PostgreSQL syntax) ────
  db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      name            TEXT    NOT NULL,
      email           TEXT    UNIQUE NOT NULL,
      password_hash   TEXT    NOT NULL,
      role            TEXT    DEFAULT 'employee',
      department      TEXT,
      location        TEXT    DEFAULT 'Hyderabad',
      employee_id     TEXT    UNIQUE,
      salary          NUMERIC DEFAULT 0,
      paid_leaves     INTEGER DEFAULT 12,
      bank_account    TEXT,
      ifsc_code       TEXT,
      pan_number      TEXT,
      date_of_birth   TEXT,
      date_of_joining TEXT,
status          TEXT    DEFAULT 'active',
      permissions     TEXT    DEFAULT '{}',
      plain_password  TEXT,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  .then(async () => {
    console.log("✅ users table ready");

    // Seed chairman if no users exist
    const { rows } = await db.query("SELECT COUNT(*) as cnt FROM users");
    if (parseInt(rows[0].cnt) === 0) {
      const hash = bcrypt.hashSync("chairman123", 10);
      await db.query(
        `INSERT INTO users (name, email, password_hash, role, employee_id, permissions)
         VALUES ($1, $2, $3, 'chairman', 'VJC-CHAIR-001', $4)`,
        [
          "Chairman",
          "chairman@vjcoverseas.com",
          hash,
          JSON.stringify({
            customers: true, invoices: true, quotes: true,
            payments: true, reports: true, expenses: true,
            services: true, employees: true
          })
        ]
      );
      console.log("✅ Default chairman seeded: chairman@vjcoverseas.com / chairman123");
    }
  })
  .catch((err) => console.error("Users table error:", err));

  // ── Middleware: verify JWT ────────────────────────────────
  const auth = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, message: "No token" });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ success: false, message: "Invalid token" });
    }
  };

  const chairmanOnly = (req, res, next) => {
    if (req.user.role !== "chairman" && req.user.role !== "mis-executive")
      return res.status(403).json({ success: false, message: "Chairman only" });
    next();
  };

  // ── POST /api/auth/login ──────────────────────────────────
  router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required" });

    try {
const { rows } = await db.query(
  `SELECT id, name, email, role, location, department, status, permissions, employee_id,
          password_hash, plain_password
   FROM users WHERE email = $1 AND status = 'active'`,
  [email]
);
      const user = rows[0];
      if (!user)
        return res.status(401).json({ success: false, message: "Invalid credentials" });

      console.log("==================================");
console.log("Email:", email);
console.log("Password from UI:", password);
console.log("Password Hash:", user.password_hash);

const valid = bcrypt.compareSync(password, user.password_hash);

if (!valid) {
  return res.status(401).json({
    success: false,
    message: "Invalid credentials",
    debug: {
      email,
      plainPassword: user.plain_password,
      hash: user.password_hash
    }
  });
}

console.log("Compare Result:", valid);
console.log("==================================");

if (!valid)
  return res.status(401).json({
    success: false,
    message: "Invalid credentials"
  });

// plain_password null unte — first login lo auto-save cheyyi
if (!user.plain_password) {
  await db.query(
    `UPDATE users SET plain_password = $1 WHERE id = $2`,
    [password, user.id]
  );
}

      const permissions = (() => {
        try { return JSON.parse(user.permissions); } catch { return {}; }
      })();

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, name: user.name, permissions },
        JWT_SECRET,
        { expiresIn: "8h" }
      );

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          employee_id: user.employee_id,
          location: user.location,
          department: user.department,
          permissions,
        }
      });
    } catch (err) {
  console.error("Login error:", err);

  res.status(500).json({
    success: false,
    message: err.message,
    error: err.stack
  });
}
  });

  // ── GET /api/auth/me ──────────────────────────────────────
  router.get("/me", auth, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT id,name,email,role,employee_id,location,department,permissions,status FROM users WHERE id=$1",
        [req.user.id]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ success: false });
      const permissions = (() => { try { return JSON.parse(user.permissions); } catch { return {}; } })();
      res.json({ success: true, user: { ...user, permissions } });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // ── GET /api/auth/employees ───────────────────────────────
  router.get("/employees", auth, chairmanOnly, async (req, res) => {
    try {
      const { rows } = await db.query(
`SELECT id, name, email, role, employee_id, location, department,
                salary, status, permissions, plain_password, created_at
         FROM users
         WHERE role != 'chairman'
         ORDER BY created_at DESC`
      );
      const employees = rows.map(r => ({
        ...r,
        permissions: (() => { try { return JSON.parse(r.permissions); } catch { return {}; } })()
      }));
      res.json({ success: true, employees });
    } catch (err) {
      console.error("Get employees error:", err);
      res.status(500).json({ success: false, message: "Failed to fetch employees" });
    }
  });

  // ── POST /api/auth/employees ── Add Employee ─────────────
  router.post("/employees", auth, chairmanOnly, async (req, res) => {
    console.log("ADD EMPLOYEE API HIT");
    const {
      name, email, password, department, role, location,
      salary, paid_leaves, bank_account, ifsc_code, pan_number,
      date_of_birth, date_of_joining, permissions
    } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email, password required" });

    try {
      // Auto-generate employee ID: VJC-HYD-2026-001
      const locationCode = (location || "Hyderabad").startsWith("Hyderabad") ? "HYD" : "BLR";
      const year = new Date().getFullYear();

      const countResult = await db.query(
        `SELECT COUNT(*) as cnt FROM users
         WHERE location = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
        [location || "Hyderabad", year]
      );
      const seq = String(parseInt(countResult.rows[0].cnt) + 1).padStart(3, "0");
      const employee_id = `VJC-${locationCode}-${year}-${seq}`;

      const password_hash = bcrypt.hashSync(password, 10);
      const permsJson = JSON.stringify(permissions || {});

     await db.query(
        `INSERT INTO users
           (name, email, password_hash, plain_password, role, department, location, employee_id,
            salary, paid_leaves, bank_account, ifsc_code, pan_number,
            date_of_birth, date_of_joining, permissions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          name, email, password_hash, password,
          role || "employee", department || null, location || "Hyderabad", employee_id,
          salary || 0, paid_leaves || 12,
          bank_account || null, ifsc_code || null, pan_number || null,
          date_of_birth || null, date_of_joining || null, permsJson
        ]
      );

      // Send credentials email (non-blocking)
      sendCredentialsEmail(name, email, password, employee_id, role, location);

      res.json({
        success: true,
        employee_id,
        message: `Employee created! ID: ${employee_id}`
      });

    } catch (err) {
  console.error("Create employee error:", err);

  return res.status(500).json({
    success: false,
    code: err.code,
    constraint: err.constraint,
    detail: err.detail,
    message: err.message
  });
}
});
  // ── PUT /api/auth/employees/:id ── Update employee ───────
  router.put("/employees/:id", auth, chairmanOnly, async (req, res) => {
    const {
      permissions, status, salary,
      name, email, department, role, location,
      bank_account, ifsc_code, pan_number, date_of_birth, date_of_joining,
      paid_leaves, new_password,
    } = req.body;
    const updates = [];
    const vals = [];
    let idx = 1;

    if (permissions !== undefined) {
      updates.push(`permissions = $${idx++}`);
      vals.push(JSON.stringify(permissions));
    }
    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      vals.push(status);
    }
    if (salary !== undefined) {
      updates.push(`salary = $${idx++}`);
      vals.push(salary);
    }
    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      vals.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      vals.push(email);
    }
    if (department !== undefined) {
      updates.push(`department = $${idx++}`);
      vals.push(department);
    }
    if (role !== undefined) {
      updates.push(`role = $${idx++}`);
      vals.push(role);
    }
    if (location !== undefined) {
      updates.push(`location = $${idx++}`);
      vals.push(location);
    }
    if (bank_account !== undefined) {
      updates.push(`bank_account = $${idx++}`);
      vals.push(bank_account);
    }
    if (ifsc_code !== undefined) {
      updates.push(`ifsc_code = $${idx++}`);
      vals.push(ifsc_code);
    }
    if (pan_number !== undefined) {
      updates.push(`pan_number = $${idx++}`);
      vals.push(pan_number);
    }
    if (date_of_birth !== undefined) {
      updates.push(`date_of_birth = $${idx++}`);
      vals.push(date_of_birth);
    }
    if (date_of_joining !== undefined) {
      updates.push(`date_of_joining = $${idx++}`);
      vals.push(date_of_joining);
    }
    if (paid_leaves !== undefined) {
      updates.push(`paid_leaves = $${idx++}`);
      vals.push(paid_leaves);
    }
    if (new_password) {
      const hash = bcrypt.hashSync(new_password, 10);
      updates.push(`password_hash = $${idx++}`);
      vals.push(hash);
      updates.push(`plain_password = $${idx++}`);
      vals.push(new_password);
    }

    if (updates.length === 0)
      return res.status(400).json({ success: false, message: "Nothing to update" });

    vals.push(req.params.id);
    try {
      await db.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}`,
        vals
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Update employee error:", err);
      res.status(500).json({ success: false });
    }
  });
  // ── DELETE /api/auth/employees/:id ───────────────────────
  router.delete("/employees/:id", auth, chairmanOnly, async (req, res) => {
    try {
      await db.query(
        "UPDATE users SET status = 'inactive' WHERE id = $1",
        [req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false });
    }
  });

  // ── Email helper ─────────────────────────────────────────
  function sendCredentialsEmail(name, email, password, employee_id, role, location) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      transporter.sendMail({
        from: `"VJC Overseas" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Your VJC BDMS Login Credentials",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden">
            <div style="background:#1976d2;color:#fff;padding:20px">
              <h2 style="margin:0">Welcome to VJC Overseas!</h2>
              <p style="margin:4px 0 0;opacity:0.85">Your BDMS account is ready</p>
            </div>
            <div style="padding:24px">
              <p>Hi <strong>${name}</strong>,</p>
              <p>Your login credentials for VJC Invoice &amp; Business Dashboard:</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Employee ID</td><td style="padding:8px">${employee_id}</td></tr>
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Role</td><td style="padding:8px">${role || "Employee"}</td></tr>
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Location</td><td style="padding:8px">${location}</td></tr>
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Email</td><td style="padding:8px">${email}</td></tr>
                <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Password</td><td style="padding:8px;color:#d32f2f;font-weight:bold">${password}</td></tr>
              </table>
              <p style="color:#888;font-size:12px">Please change your password after first login.</p>
            </div>
          </div>
        `
      });
    } catch (e) {
      console.log("Email send error:", e.message);
    }
  }

  return router;
};
const JWT_SECRET_EXPORT = process.env.JWT_SECRET || "vjc_invoice_secret_2024";
const jwt_export = require("jsonwebtoken");
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, message: "No token" });
  try {
    req.user = jwt_export.verify(token, JWT_SECRET_EXPORT);
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};
module.exports.verifyToken = verifyToken;