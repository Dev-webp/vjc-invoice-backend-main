const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/expense.controller");
const multer  = require("multer");
const path    = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/receipts"),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });
router.get("/notifications/due",     ctrl.getDueNotifications);
router.post("/upload-receipt",       upload.single("receipt"), ctrl.uploadReceipt);
router.get("/",                  ctrl.getAll);
router.get("/:id",               ctrl.getById);
router.post("/",                 ctrl.create);
router.put("/:id",               ctrl.update);
router.put("/:id/convert",       ctrl.convertToInvoice);
router.put("/:id/reimburse",     ctrl.reimburse);
router.delete("/:id",            ctrl.remove);

module.exports = router;