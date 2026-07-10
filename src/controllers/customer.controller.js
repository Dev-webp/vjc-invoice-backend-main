const customerService = require('../services/customer.service');

const customerController = {

  // GET /api/customers
  getAll: async (req, res) => {
    try {
      const { search, status, type, page, limit } = req.query;
      const role   = req.user?.role;
      const userId = req.user?.id;
      const data = await customerService.getAllCustomers({ search, status, type, role, userId, page, limit });
      res.json({ success: true, ...data });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // GET /api/customers/:id
  getById: async (req, res) => {
    try {
      const customer = await customerService.getCustomerById(req.params.id);
      res.json({ success: true, customer });
    } catch (err) {
      res.status(404).json({ success: false, message: err.message });
    }
  },

  // POST /api/customers
  create: async (req, res) => {
    try {
      const customer = await customerService.createCustomer({
        ...req.body,
        created_by: req.user?.id,        // ← ADD
      });
      res.status(201).json({ success: true, customer });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },

  // PUT /api/customers/:id
  update: async (req, res) => {
    try {
      const customer = await customerService.updateCustomer(req.params.id, req.body);
      res.json({ success: true, customer });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  },

  // DELETE /api/customers/:id
  delete: async (req, res) => {
    try {
      await customerService.deleteCustomer(req.params.id);
      res.json({ success: true, message: 'Customer deleted successfully' });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
};

module.exports = customerController;