const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const routes = require('./routes/index');
const authRoutes = require('./routes/auth');
const pool = require('./config/db');

const { createPaymentTable } = require('./models/payment.model');
const { createRecurringInvoiceTable } = require('./models/recurringInvoice.model');
const { createExpenseTable } = require('./models/expense.model');

const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Serve static files
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.use('/api', routes);
app.use('/api/auth', authRoutes(pool)); // ← pass pool here ✅

app.get('/', (req, res) => {
  res.json({ message: 'VJC Invoice API Running!' });
});

// Auto-create tables
Promise.all([
  createPaymentTable(),
  createRecurringInvoiceTable(),
  createExpenseTable(),
])
  .then(() => console.log('✅ All tables ready'))
  .catch((err) => console.error('❌ Table error:', err));

module.exports = app;