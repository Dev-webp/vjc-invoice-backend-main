const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/recurringInvoice.controller");

router.get("/",                      ctrl.getAll);
router.get("/:id",                   ctrl.getById);
router.post("/",                     ctrl.create);
router.put("/:id",                   ctrl.update);
router.put("/:id/stop",              ctrl.stop);
router.put("/:id/resume",            ctrl.resume);
router.post("/:id/generated-invoice", ctrl.addGeneratedInvoice);
router.delete("/:id",                ctrl.remove);

module.exports = router;