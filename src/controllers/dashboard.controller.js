const dashboardRepo = require('../repositories/dashboard.repository');

const getKpis = async (req, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const data = await dashboardRepo.getKpis(role, userId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSalesExpensesOverview = async (req, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const year = req.query.year;   // NEW — optional ?year=2027
    const data = await dashboardRepo.getSalesExpensesOverview(role, userId, year);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getRecentInvoices = async (req, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const data = await dashboardRepo.getRecentInvoices(role, userId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getKpis, getSalesExpensesOverview, getRecentInvoices };