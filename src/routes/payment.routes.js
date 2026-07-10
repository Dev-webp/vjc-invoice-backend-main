// ============================================================
// FILE: VJC-Invoice-backend/src/routes/payment.routes.js
// ============================================================

const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/payment.controller");

const { verifyToken } = require('../middlewares/auth.middleware');  // ← ADD

router.get("/",              verifyToken, ctrl.getAll);             // ← ADD
router.get("/:id",           verifyToken, ctrl.getById);
router.post("/",             verifyToken, ctrl.create);
router.put("/:id/reminder",  verifyToken, ctrl.remind);
router.put("/:id/record",    verifyToken, ctrl.record);
router.put("/:id/void",      verifyToken, ctrl.voidPay);
router.delete("/:id",        verifyToken, ctrl.remove);

module.exports = router;
