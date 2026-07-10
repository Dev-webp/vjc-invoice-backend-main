const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || "vjc_invoice_secret_2024";

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  try {
    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};

const chairmanOnly = (req, res, next) => {
  if (req.user?.role !== "chairman") {
    return res.status(403).json({ success: false, message: "Chairman only" });
  }
  next();
};

const servicesAccess = (req, res, next) => {
  if (req.user?.role === "chairman" || req.user?.permissions?.services) {
    return next();
  }
  return res.status(403).json({ success: false, message: "You don't have access to manage services" });
};

module.exports = { verifyToken, chairmanOnly, servicesAccess };