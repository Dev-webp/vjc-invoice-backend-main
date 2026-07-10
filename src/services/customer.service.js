const customerRepository = require('../repositories/customer.repository');
const { generateCustomerId } = require('../models/customer');

const customerService = {

  getAllCustomers: async (filters) => {
    const { rows: customers, total } = await customerRepository.getAll(filters);
    const stats = await customerRepository.getStats(filters.role, filters.userId);
if (filters.role !== "chairman") {
  customers.forEach((customer, index) => {
    customer.display_customer_id =
      "CUS" + String(index + 1).padStart(3, "0");
  });
}

const page  = Number(filters.page)  || 1;
const limit = Number(filters.limit) || 25;
const totalPages = Math.ceil(total / limit);

return { customers, stats, total, page, totalPages };
  },

  getCustomerById: async (id) => {
    const customer = await customerRepository.getById(id);
    if (!customer) throw new Error('Customer not found');
    return customer;
  },

  createCustomer: async (data) => {
  // Check duplicate email
  const { rows: existing } = await customerRepository.getAll({
    search: data.email,
    role: 'chairman', // always check all customers for duplicate email
    userId: null,
  });

  const emailExists = existing.find(
    c => c.email?.toLowerCase() === data.email?.toLowerCase()
  );

  if (emailExists) throw new Error('Email already exists');

  // Auto-generate customer_id
  const customer_id = await generateCustomerId();
  return await customerRepository.create({ ...data, customer_id });
},

  updateCustomer: async (id, data) => {
    const customer = await customerRepository.getById(id);
    if (!customer) throw new Error('Customer not found');
    return await customerRepository.update(id, data);
  },

  deleteCustomer: async (id) => {
    const customer = await customerRepository.getById(id);
    if (!customer) throw new Error('Customer not found');
    return await customerRepository.delete(id);
  }
};

module.exports = customerService;