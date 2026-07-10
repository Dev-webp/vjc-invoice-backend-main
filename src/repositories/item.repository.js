const pool = require('../config/db');

const itemRepository = {

  getAll: async ({ search, status, category, role, userId, page = 1, limit = 25 }) => {
    let baseQuery = ' FROM items WHERE 1=1';
    const values = [];
    let i = 1;

    if (search) {
      baseQuery += ` AND (service_name ILIKE $${i} OR category ILIKE $${i} OR country ILIKE $${i})`;
      values.push(`%${search}%`);
      i++;
    }
    if (status && status !== 'All') {
      baseQuery += ` AND status = $${i}`;
      values.push(status);
      i++;
    }
    if (category && category !== 'All') {
      baseQuery += ` AND category = $${i}`;
      values.push(category);
      i++;
    }

    const countResult = await pool.query(`SELECT COUNT(*)${baseQuery}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const offset = (page - 1) * limit;
    const dataQuery = `SELECT *${baseQuery} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`;
    const result = await pool.query(dataQuery, [...values, limit, offset]);

    return { rows: result.rows, total };
  },

  getById: async (id) => {
    const result = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
    return result.rows[0];
  },

  create: async (data) => {
    const {
      item_id, service_name, category, country,
      price, gst, duration, documents, description, status, created_by
    } = data;

    const result = await pool.query(
      `INSERT INTO items
        (item_id, service_name, category, country, price, gst,
         duration, documents, description, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [item_id, service_name, category, country,
       price, gst, duration, documents, description, status, created_by || null]
    );
    return result.rows[0];
  },

  update: async (id, data) => {
    const {
      service_name, category, country, price, gst,
      duration, documents, description, status
    } = data;

    const result = await pool.query(
      `UPDATE items SET
        service_name=$1, category=$2, country=$3, price=$4,
        gst=$5, duration=$6, documents=$7, description=$8,
        status=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [service_name, category, country, price, gst,
       duration, documents, description, status, id]
    );
    return result.rows[0];
  },

  delete: async (id) => {
    const result = await pool.query(
      'DELETE FROM items WHERE id = $1 RETURNING *', [id]
    );
    return result.rows[0];
  },

  getStats: async (role, userId) => {
    const whereClause = '';
    const itemResult = await pool.query(`
      SELECT
        COUNT(*) as total_items,
        COUNT(CASE WHEN status='Active' THEN 1 END) as active_items
      FROM items ${whereClause}
    `);
    const revenueResult = await pool.query(`
  SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
  FROM invoices
  WHERE status = 'Approved'
`);
const mostSoldResult = await pool.query(`
  SELECT service_type
  FROM invoices
  WHERE status = 'Approved'
  GROUP BY service_type
  ORDER BY COUNT(*) DESC
  LIMIT 1
`);
    return {
  ...itemResult.rows[0],
  total_revenue: revenueResult.rows[0].total_revenue,
  most_sold: mostSoldResult.rows[0]?.service_type || "-",
};
  },
};

module.exports = itemRepository;