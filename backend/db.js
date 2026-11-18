// MySQL data layer (works with local MySQL and TiDB Cloud). Async, built on mysql2 connection pool.
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// ---- connection settings (environment variables) ----
// Either DATABASE_URL=mysql://user:pass@host:4000/dbname  or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.
// Set DB_SSL=true for TiDB Cloud / any managed MySQL that requires TLS.
function config() {
  let c = {
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pwms'
  };
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    c = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, '') || 'pwms' };
  }
  const ssl = (process.env.DB_SSL === 'true' || process.env.DATABASE_URL) && process.env.DB_SSL !== 'false'
    ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined;
  return { ...c, ssl, dateStrings: true, decimalNumbers: true, charset: 'utf8mb4' };
}

let pool;
const norm = p => (p || []).map(v => (v === undefined ? null : v));

// executor shared by the pool and by transactions: x.get / x.all / x.run
const makeExec = conn => ({
  async all(sql, params) { const [rows] = await conn.query(sql, norm(params)); return rows; },
  async get(sql, params) { const [rows] = await conn.query(sql, norm(params)); return rows[0]; },
  async run(sql, params) { const [r] = await conn.query(sql, norm(params)); return { id: Number(r.insertId), changes: r.affectedRows }; }
});
const db = {
  all: (s, p) => makeExec(pool).all(s, p),
  get: (s, p) => makeExec(pool).get(s, p),
  run: (s, p) => makeExec(pool).run(s, p)
};

// run fn(t) inside a transaction; t has the same get/all/run methods
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(makeExec(conn));
    await conn.commit();
    return r;
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

async function log(user, action, details, x = db) {
  await x.run('INSERT INTO audit_log(user_id,user_name,action,details) VALUES(?,?,?,?)',
    [user ? user.id : null, user ? user.name : 'system', action, details || '']);
}
async function getSetting(key, def) {
  const r = await db.get('SELECT setting_value v FROM settings WHERE setting_key=?', [key]);
  return r ? r.v : def;
}
// keep inventory table equal to the sum of the batch quantities (FR-09)
async function recalcStock(medicineId, x = db) {
  const { q } = await x.get('SELECT CAST(COALESCE(SUM(quantity),0) AS SIGNED) q FROM batches WHERE medicine_id=?', [medicineId]);
  await x.run('INSERT INTO inventory(medicine_id,quantity) VALUES(?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)', [medicineId, q]);
  return Number(q);
}

const SCHEMA = [
`CREATE TABLE IF NOT EXISTS suppliers(
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL, contact_person VARCHAR(150), email VARCHAR(150), phone VARCHAR(50),
  address VARCHAR(255), active TINYINT NOT NULL DEFAULT 1)`,
`CREATE TABLE IF NOT EXISTS users(
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE, password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(30) NOT NULL, supplier_id INT NULL, active TINYINT NOT NULL DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id))`,
`CREATE TABLE IF NOT EXISTS categories(
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL UNIQUE, description VARCHAR(255), active TINYINT NOT NULL DEFAULT 1)`,
`CREATE TABLE IF NOT EXISTS medicines(
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190) NOT NULL, category_id INT NOT NULL, unit VARCHAR(30) DEFAULT 'units',
  low_stock_limit INT NULL, description VARCHAR(255), active TINYINT NOT NULL DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES categories(id))`,
`CREATE TABLE IF NOT EXISTS offers(
  id INT AUTO_INCREMENT PRIMARY KEY, supplier_id INT NOT NULL, medicine_id INT NOT NULL, price DOUBLE NOT NULL, note VARCHAR(255),
  active TINYINT NOT NULL DEFAULT 1,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id), FOREIGN KEY (medicine_id) REFERENCES medicines(id))`,
`CREATE TABLE IF NOT EXISTS purchases(
  id INT AUTO_INCREMENT PRIMARY KEY, medicine_id INT NOT NULL, supplier_id INT NULL, quantity INT NOT NULL, notes VARCHAR(500),
  status VARCHAR(30) NOT NULL DEFAULT 'Draft', created_by INT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id), FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (created_by) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS purchase_orders(
  id INT AUTO_INCREMENT PRIMARY KEY, po_number VARCHAR(50) NOT NULL, purchase_id INT NOT NULL, supplier_id INT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Sent', proposed_quantity INT NULL, supplier_note VARCHAR(500),
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP, responded_at DATETIME NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id), FOREIGN KEY (supplier_id) REFERENCES suppliers(id))`,
`CREATE TABLE IF NOT EXISTS batches(
  id INT AUTO_INCREMENT PRIMARY KEY, medicine_id INT NOT NULL, batch_no VARCHAR(80) NOT NULL, quantity INT NOT NULL,
  received_quantity INT NOT NULL, mfg_date DATE NOT NULL, expiry_date DATE NOT NULL, purchase_id INT NULL, received_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id), FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  FOREIGN KEY (received_by) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS inventory(
  medicine_id INT PRIMARY KEY, quantity INT NOT NULL DEFAULT 0, FOREIGN KEY (medicine_id) REFERENCES medicines(id))`,
`CREATE TABLE IF NOT EXISTS return_reports(
  id INT AUTO_INCREMENT PRIMARY KEY, batch_id INT NOT NULL, type VARCHAR(20) NOT NULL, quantity INT NOT NULL, reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending', reported_by INT NOT NULL, reviewed_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME NULL,
  FOREIGN KEY (batch_id) REFERENCES batches(id), FOREIGN KEY (reported_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS stock_audits(
  id INT AUTO_INCREMENT PRIMARY KEY, status VARCHAR(20) NOT NULL DEFAULT 'Open', started_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME NULL, FOREIGN KEY (started_by) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS audit_items(
  id INT AUTO_INCREMENT PRIMARY KEY, audit_id INT NOT NULL, medicine_id INT NOT NULL, recorded_qty INT NOT NULL,
  physical_qty INT NULL, difference INT NULL, adjustment_status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  FOREIGN KEY (audit_id) REFERENCES stock_audits(id), FOREIGN KEY (medicine_id) REFERENCES medicines(id))`,
`CREATE TABLE IF NOT EXISTS settings(setting_key VARCHAR(100) PRIMARY KEY, setting_value VARCHAR(255))`,
`CREATE TABLE IF NOT EXISTS audit_log(
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL, user_name VARCHAR(150), action VARCHAR(60) NOT NULL, details VARCHAR(1000),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
];

// ---- seed sample data on first run ----
async function seed() {
  if ((await db.get('SELECT COUNT(*) c FROM users')).c > 0) return;
  const h = p => bcrypt.hashSync(p, 8);
  const run = (s, p) => db.run(s, p);
  for (const [k, v] of [['warehouse_name', 'Central Pharma Warehouse'], ['default_low_stock_limit', '100'], ['expiry_alert_days', '60']])
    await run('INSERT INTO settings(setting_key,setting_value) VALUES(?,?)', [k, v]);
  for (const s of [['MediSupply Co.', 'Ravi Kumar', 'sales@medisupply.com', '9876500001', 'Mumbai'],
    ['HealWell Distributors', 'Anita Shah', 'orders@healwell.com', '9876500002', 'Delhi']])
    await run('INSERT INTO suppliers(name,contact_person,email,phone,address) VALUES(?,?,?,?,?)', s);
  for (const u of [['Admin User', 'admin@pwms.com', h('admin123'), 'Admin', null],
    ['Manager Meera', 'manager@pwms.com', h('manager123'), 'Warehouse Manager', null],
    ['Worker Wasim', 'worker@pwms.com', h('worker123'), 'Warehouse Worker', null],
    ['Worker Wendy', 'worker2@pwms.com', h('worker123'), 'Warehouse Worker', null],
    ['MediSupply Rep', 'supplier@pwms.com', h('supplier123'), 'Supplier', 1],
    ['HealWell Rep', 'supplier2@pwms.com', h('supplier123'), 'Supplier', 2]])
    await run('INSERT INTO users(name,email,password_hash,role,supplier_id) VALUES(?,?,?,?,?)', u);
  for (const c of [['Antibiotics', 'Bacterial infection medicines'], ['Painkillers', 'Analgesics and anti-inflammatory'],
    ['Vitamins', 'Supplements'], ['Antacids', 'Digestive medicines']])
    await run('INSERT INTO categories(name,description) VALUES(?,?)', c);
  for (const m of [['Amoxicillin 500mg', 1, 'strips', 150, 'Capsules'], ['Azithromycin 250mg', 1, 'strips', 100, 'Tablets'],
    ['Paracetamol 650mg', 2, 'strips', 200, 'Tablets'], ['Ibuprofen 400mg', 2, 'strips', 100, 'Tablets'],
    ['Vitamin C 500mg', 3, 'bottles', 80, 'Chewable'], ['Pantoprazole 40mg', 4, 'strips', 120, 'Tablets']])
    await run('INSERT INTO medicines(name,category_id,unit,low_stock_limit,description) VALUES(?,?,?,?,?)', m);
  for (const o of [[1, 1, 42.5, 'Bulk discount above 500'], [1, 3, 12, 'Fast delivery'], [2, 3, 11.5, ''], [2, 5, 60, '']])
    await run('INSERT INTO offers(supplier_id,medicine_id,price,note) VALUES(?,?,?,?)', o);
  const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  for (const [m, b, q, mf, ex] of [[1, 'AMX-001', 120, d(-200), d(400)], [2, 'AZI-001', 300, d(-150), d(500)], [3, 'PCM-001', 150, d(-300), d(30)],
    [3, 'PCM-002', 100, d(-60), d(600)], [4, 'IBU-001', 90, d(-100), d(300)], [5, 'VTC-001', 400, d(-50), d(700)], [6, 'PAN-001', 250, d(-80), d(450)]])
    await run('INSERT INTO batches(medicine_id,batch_no,quantity,received_quantity,mfg_date,expiry_date,received_by) VALUES(?,?,?,?,?,?,3)', [m, b, q, q, mf, ex]);
  for (let m = 1; m <= 6; m++) await recalcStock(m);
  await log(null, 'SEED', 'Sample data created');
}

// create database (if allowed), tables and sample data. Call once before the server starts listening.
async function init() {
  const cfg = config();
  try { // create the database if it does not exist yet (ignored when the user lacks permission)
    const boot = await mysql.createConnection({ ...cfg, database: undefined });
    await boot.query('CREATE DATABASE IF NOT EXISTS `' + cfg.database.replace(/`/g, '') + '`');
    await boot.end();
  } catch { /* database probably exists already */ }
  pool = mysql.createPool({ ...cfg, waitForConnections: true, connectionLimit: 10 });
  await pool.query('SELECT 1');
  for (const ddl of SCHEMA) await pool.query(ddl);
  await seed();
  console.log(`Database ready (MySQL ${cfg.host}:${cfg.port}/${cfg.database})`);
}

const isDup = e => e && e.code === 'ER_DUP_ENTRY';

module.exports = { db, tx, log, getSetting, recalcStock, init, isDup };
