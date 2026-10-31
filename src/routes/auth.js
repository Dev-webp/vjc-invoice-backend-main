// ─── routes/auth.js ─────────────────────────────────────────
const express    = require("express");
const router     = express.Router();
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in the environment");
}

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
                salary, status, permissions, plain_password, created_at, office_number
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

      const idResult = await db.query(
        `SELECT employee_id FROM users
         WHERE employee_id LIKE $1
         ORDER BY employee_id DESC LIMIT 1`,
        [`VJC-${locationCode}-${year}-%`]
      );
      let seq = "001";
      if (idResult.rows.length > 0) {
        const lastSeq = parseInt(idResult.rows[0].employee_id.split("-").pop());
        seq = String(lastSeq + 1).padStart(3, "0");
      }
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

      // NEW — office number is optional, saved separately so the existing
      // INSERT statement above stays 100% untouched
      if (req.body.office_number) {
        await db.query(
          `UPDATE users SET office_number = $1 WHERE employee_id = $2`,
          [req.body.office_number, employee_id]
        );
      }

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
      paid_leaves, new_password, employee_id,
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
    if (employee_id !== undefined) {
      updates.push(`employee_id = $${idx++}`);
      vals.push(employee_id);
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
    if (req.body.office_number !== undefined) {   // NEW
      updates.push(`office_number = $${idx++}`);
      vals.push(req.body.office_number);
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

  // ── POST /api/auth/sync-user ───────────────────────────────
  // Called by HRMS backend to sync employee permissions to Invoice/CRM system
  router.post("/sync-user", async (req, res) => {
    const syncSecret = req.headers["x-sync-secret"];
    if (syncSecret !== process.env.HRMS_INVOICE_SSO_SECRET) {
      return res.status(403).json({ success: false, message: "Invalid sync secret" });
    }

    const { name, email, department, location, employee_id, permissions } = req.body;

    if (!email || !employee_id) {
      return res.status(400).json({ success: false, message: "Email and employee_id required" });
    }

    try {
      // Check if user exists by email
      const existingUser = await db.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );

      const permsJson = JSON.stringify(permissions || {});

      if (existingUser.rows.length > 0) {
        // Update existing user
        await db.query(
          `UPDATE users
           SET name = $1, department = $2, location = $3, employee_id = $4, permissions = $5
           WHERE email = $6`,
          [name, department, location, employee_id, permsJson, email]
        );
        res.json({ success: true, message: "User updated" });
      } else {
        // Create new user
        const password = Math.random().toString(36).slice(-8);
        const password_hash = bcrypt.hashSync(password, 10);

        await db.query(
          `INSERT INTO users
           (name, email, password_hash, plain_password, department, location, employee_id, permissions)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [name, email, password_hash, password, department, location, employee_id, permsJson]
        );
        res.json({ success: true, message: "User created", password });
      }
    } catch (err) {
      console.error("Sync user error:", err);
      res.status(500).json({ success: false, message: err.message });
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

  // ── POST /api/auth/sso ── SSO Token Exchange from HRMS ───────
  router.post("/sso", async (req, res) => {
    const { ssoToken } = req.body;

    if (!ssoToken) {
      return res.status(400).json({ success: false, message: "SSO token required" });
    }

    try {
      // Verify the SSO token using the shared secret (must match HRMS_INVOICE_SSO_SECRET from HRMS backend)
    const SSO_SECRET = process.env.HRMS_INVOICE_SSO_SECRET;

if (!SSO_SECRET) {
  throw new Error("HRMS_INVOICE_SSO_SECRET must be configured");
}
      let decoded;
      try {
        decoded = jwt.verify(ssoToken, SSO_SECRET);
      } catch (err) {
        console.error("[SSO] Token verification failed:", err.message);
        return res.status(401).json({ success: false, message: "Invalid SSO token" });
      }

      // Validate token purpose
      if (decoded.purpose !== "invoice_sso") {
        return res.status(401).json({ success: false, message: "Invalid token purpose" });
      }

      const { email, employee_code, hrms_user_id, role, full_name, department, branch } = decoded;

      if (!email) {
        return res.status(400).json({ success: false, message: "Email required in SSO token" });
      }

      // Check if user exists in Invoice database
      const { rows } = await db.query(
        "SELECT id, name, email, role, employee_id, location, department, permissions, status FROM users WHERE email = $1",
        [email]
      );

      let user;
      if (rows.length === 0) {
        // User doesn't exist - create them based on HRMS data
        const employee_id = employee_code || `VJC-SSO-${hrms_user_id}`;
        const password_hash = bcrypt.hashSync("sso_user_initial_pass", 10);

        // Map HRMS role to Invoice role
        const invoiceRole = role === "chairman" ? "chairman" : "employee";

        // Set permissions based on role
        const permissions = JSON.stringify(
          invoiceRole === "chairman"
            ? {
                customers: true, invoices: true, quotes: true,
                payments: true, reports: true, expenses: true,
                services: true, employees: true
              }
            : {
                customers: true, invoices: true, quotes: true,
                payments: true, reports: true, expenses: true,
                services: true, employees: false
              }
        );

        const insertResult = await db.query(
          `INSERT INTO users
             (name, email, password_hash, plain_password, role, department, location, employee_id,
              salary, paid_leaves, bank_account, ifsc_code, pan_number,
              date_of_birth, date_of_joining, permissions, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id, name, email, role, employee_id, location, department, permissions, status`,
          [
            full_name || email.split("@")[0] || "SSO User", // Use full_name from HRMS or email prefix
            email,
            password_hash,
            "sso_user_initial_pass",
            invoiceRole,
            department || null,
            branch || "Hyderabad",
            employee_id,
            0,
            12,
            null,
            null,
            null,
            null,
            null,
            permissions,
            "active"
          ]
        );
        user = insertResult.rows[0];
        console.log(`[SSO] Created new user: ${email} with role: ${invoiceRole}, employee_id: ${employee_id}`);
      } else {
        user = rows[0];
        // Update user if inactive
        if (user.status !== "active") {
          await db.query(
            "UPDATE users SET status = 'active' WHERE id = $1",
            [user.id]
          );
          user.status = "active";
        }

        // Sync role from HRMS if provided and different
        if (role) {
          const invoiceRole = role === "chairman" ? "chairman" : "employee";
          if (user.role !== invoiceRole) {
            await db.query(
              "UPDATE users SET role = $1 WHERE id = $2",
              [invoiceRole, user.id]
            );
            user.role = invoiceRole;
            console.log(`[SSO] Updated user role: ${email} -> ${invoiceRole}`);
          }
        }

        // Sync name from HRMS if provided
        if (full_name && user.name !== full_name) {
          await db.query(
            "UPDATE users SET name = $1 WHERE id = $2",
            [full_name, user.id]
          );
          user.name = full_name;
        }

        console.log(`[SSO] Found existing user: ${email}`);
      }

      // Parse permissions
      const permissions = (() => {
        try { return JSON.parse(user.permissions); } catch { return {}; }
      })();

      // Generate Invoice-specific JWT token
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
      console.error("SSO exchange error:", err);
      res.status(500).json({ success: false, message: "SSO exchange failed" });
    }
  });

  return router;
};
const JWT_SECRET_EXPORT = JWT_SECRET;
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