// Auth, users, suppliers, offers, categories, medicines, settings, audit log
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, log, getSetting, isDup } = require('../db');
const { sign, auth, allow } = require('../auth');

const ROLES = ['Admin', 'Warehouse Manager', 'Warehouse Worker', 'Supplier'];
const n = v => (v === undefined || v === '' ? null : v);
const flag = v => (v === false || v === 0 || v === '0' ? 0 : 1);
const bad = (res, msg) => res.status(400).json({ error: msg });
const req_ = (res, o, fields) => {
  for (const f of fields) if (o[f] === undefined || o[f] === null || String(o[f]).trim() === '') { bad(res, `${f.replace('_', ' ')} is required`); return false; }
  return true;
};

// ---------- authentication (FR-01) ----------
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return bad(res, 'Email and password are required');
  const u = await db.get('SELECT * FROM users WHERE email=?', [String(email).trim().toLowerCase()]);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (!u.active) return res.status(403).json({ error: 'This account is deactivated' });
  await log(u, 'LOGIN', u.email);
  res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role, supplier_id: u.supplier_id } });
});
router.get('/auth/me', auth, (req, res) => res.json(req.user));

// ---------- users (FR-03, Admin) ----------
router.get('/users', auth, allow('Admin'), async (req, res) =>
  res.json(await db.all(`SELECT u.id,u.name,u.email,u.role,u.supplier_id,u.active,s.name supplier_name
    FROM users u LEFT JOIN suppliers s ON s.id=u.supplier_id ORDER BY u.id`)));
router.post('/users', auth, allow('Admin'), async (req, res) => {
  const b = req.body;
  if (!req_(res, b, ['name', 'email', 'password', 'role'])) return;
  if (!ROLES.includes(b.role)) return bad(res, 'Invalid role');
  if (b.password.length < 6) return bad(res, 'Password must be at least 6 characters');
  if (b.role === 'Supplier' && !b.supplier_id) return bad(res, 'Select the supplier this user belongs to');
  try {
    const r = await db.run('INSERT INTO users(name,email,password_hash,role,supplier_id) VALUES(?,?,?,?,?)',
      [b.name, b.email.trim().toLowerCase(), bcrypt.hashSync(b.password, 8), b.role, b.role === 'Supplier' ? b.supplier_id : null]);
    await log(req.user, 'CREATE_USER', `${b.email} (${b.role})`);
    res.json({ id: r.id });
  } catch (e) { if (isDup(e)) return bad(res, 'Email already exists'); throw e; }
});
router.put('/users/:id', auth, allow('Admin'), async (req, res) => {
  const b = req.body, id = Number(req.params.id);
  const u = await db.get('SELECT * FROM users WHERE id=?', [id]);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (id === req.user.id && b.active === false) return bad(res, 'You cannot deactivate your own account');
  if (b.role && !ROLES.includes(b.role)) return bad(res, 'Invalid role');
  const role = b.role || u.role;
  if (role === 'Supplier' && !(b.supplier_id || u.supplier_id)) return bad(res, 'Select the supplier this user belongs to');
  const hash = b.password ? (b.password.length < 6 ? null : bcrypt.hashSync(b.password, 8)) : u.password_hash;
  if (!hash) return bad(res, 'Password must be at least 6 characters');
  try {
    await db.run('UPDATE users SET name=?,email=?,password_hash=?,role=?,supplier_id=?,active=? WHERE id=?',
      [b.name || u.name, (b.email || u.email).trim().toLowerCase(), hash, role,
        role === 'Supplier' ? (b.supplier_id || u.supplier_id) : null, b.active === undefined ? u.active : flag(b.active), id]);
  } catch (e) { if (isDup(e)) return bad(res, 'Email already exists'); throw e; }
  await log(req.user, 'UPDATE_USER', `${u.email}${b.active === false ? ' deactivated' : ''}`);
  res.json({ ok: true });
});

// ---------- suppliers (FR-04) ----------
router.get('/suppliers', auth, allow('Admin', 'Warehouse Manager'), async (req, res) =>
  res.json(await db.all('SELECT * FROM suppliers ORDER BY id')));
router.post('/suppliers', auth, allow('Admin'), async (req, res) => {
  const b = req.body;
  if (!req_(res, b, ['name'])) return;
  const r = await db.run('INSERT INTO suppliers(name,contact_person,email,phone,address) VALUES(?,?,?,?,?)',
    [b.name, n(b.contact_person), n(b.email), n(b.phone), n(b.address)]);
  await log(req.user, 'CREATE_SUPPLIER', b.name);
  res.json({ id: r.id });
});
router.put('/suppliers/:id', auth, allow('Admin'), async (req, res) => {
  const b = req.body, s = await db.get('SELECT * FROM suppliers WHERE id=?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Supplier not found' });
  await db.run('UPDATE suppliers SET name=?,contact_person=?,email=?,phone=?,address=?,active=? WHERE id=?',
    [b.name || s.name, n(b.contact_person ?? s.contact_person), n(b.email ?? s.email), n(b.phone ?? s.phone),
      n(b.address ?? s.address), b.active === undefined ? s.active : flag(b.active), s.id]);
  if (b.active === false) await db.run('UPDATE users SET active=0 WHERE supplier_id=?', [s.id]);
  await log(req.user, 'UPDATE_SUPPLIER', `${s.name}${b.active === false ? ' deactivated' : ''}`);
  res.json({ ok: true });
});
// supplier manages only own profile (FR-04, security)
router.get('/supplier/me', auth, allow('Supplier'), async (req, res) =>
  res.json(await db.get('SELECT * FROM suppliers WHERE id=?', [req.user.supplier_id])));
router.put('/supplier/me', auth, allow('Supplier'), async (req, res) => {
  const b = req.body;
  if (!req_(res, b, ['name'])) return;
  await db.run('UPDATE suppliers SET name=?,contact_person=?,email=?,phone=?,address=? WHERE id=?',
    [b.name, n(b.contact_person), n(b.email), n(b.phone), n(b.address), req.user.supplier_id]);
  await log(req.user, 'UPDATE_OWN_PROFILE', b.name);
  res.json({ ok: true });
});

// ---------- offers (Supplier: own only; Manager/Admin: view) ----------
router.get('/offers', auth, allow('Supplier', 'Warehouse Manager', 'Admin'), async (req, res) => {
  const sid = req.user.role === 'Supplier' ? req.user.supplier_id : n(req.query.supplier_id);
  res.json(await db.all(`SELECT o.*,m.name medicine_name,s.name supplier_name FROM offers o
    JOIN medicines m ON m.id=o.medicine_id JOIN suppliers s ON s.id=o.supplier_id
    WHERE (? IS NULL OR o.supplier_id=?) ORDER BY o.id DESC`, [sid, sid]));
});
router.post('/offers', auth, allow('Supplier'), async (req, res) => {
  const b = req.body;
  if (!req_(res, b, ['medicine_id', 'price'])) return;
  if (!(Number(b.price) > 0)) return bad(res, 'Price must be greater than zero');
  const r = await db.run('INSERT INTO offers(supplier_id,medicine_id,price,note) VALUES(?,?,?,?)',
    [req.user.supplier_id, b.medicine_id, Number(b.price), n(b.note)]);
  await log(req.user, 'CREATE_OFFER', `medicine ${b.medicine_id} @ ${b.price}`);
  res.json({ id: r.id });
});
router.put('/offers/:id', auth, allow('Supplier'), async (req, res) => {
  const o = await db.get('SELECT * FROM offers WHERE id=? AND supplier_id=?', [req.params.id, req.user.supplier_id]);
  if (!o) return res.status(404).json({ error: 'Offer not found' });
  const b = req.body;
  if (b.price !== undefined && !(Number(b.price) > 0)) return bad(res, 'Price must be greater than zero');
  await db.run('UPDATE offers SET price=?,note=?,active=? WHERE id=?',
    [b.price !== undefined ? Number(b.price) : o.price, n(b.note ?? o.note), b.active === undefined ? o.active : flag(b.active), o.id]);
  await log(req.user, 'UPDATE_OFFER', `offer ${o.id}`);
  res.json({ ok: true });
});

// ---------- categories (FR-05) ----------
router.get('/categories', auth, async (req, res) => res.json(await db.all('SELECT * FROM categories ORDER BY name')));
router.post('/categories', auth, allow('Admin'), async (req, res) => {
  if (!req_(res, req.body, ['name'])) return;
  try {
    const r = await db.run('INSERT INTO categories(name,description) VALUES(?,?)', [req.body.name, n(req.body.description)]);
    await log(req.user, 'CREATE_CATEGORY', req.body.name);
    res.json({ id: r.id });
  } catch (e) { if (isDup(e)) return bad(res, 'Category already exists'); throw e; }
});
router.put('/categories/:id', auth, allow('Admin'), async (req, res) => {
  const c = await db.get('SELECT * FROM categories WHERE id=?', [req.params.id]), b = req.body;
  if (!c) return res.status(404).json({ error: 'Category not found' });
  try {
    await db.run('UPDATE categories SET name=?,description=?,active=? WHERE id=?',
      [b.name || c.name, n(b.description ?? c.description), b.active === undefined ? c.active : flag(b.active), c.id]);
  } catch (e) { if (isDup(e)) return bad(res, 'Category name already exists'); throw e; }
  await log(req.user, 'UPDATE_CATEGORY', `${c.name}${b.active === false ? ' deactivated' : ''}`);
  res.json({ ok: true });
});

// ---------- medicines (FR-05, FR-06, FR-10, FR-11) ----------
async function medicineList(q, categoryId) {
  const def = Number(await getSetting('default_low_stock_limit', 100));
  const rows = await db.all(`SELECT m.*,c.name category_name,COALESCE(i.quantity,0) stock FROM medicines m
    JOIN categories c ON c.id=m.category_id LEFT JOIN inventory i ON i.medicine_id=m.id
    WHERE (? IS NULL OR m.name LIKE ? OR c.name LIKE ?) AND (? IS NULL OR m.category_id=?) ORDER BY m.name`,
    [q ? q : null, `%${q}%`, `%${q}%`, categoryId, categoryId]);
  return rows.map(m => {
    const limit = m.low_stock_limit || def;
    return { ...m, effective_limit: limit, low_stock: m.active && m.stock < limit ? 1 : 0 };
  });
}
router.get('/medicines', auth, allow('Admin', 'Warehouse Manager', 'Warehouse Worker', 'Supplier'), async (req, res) =>
  res.json(await medicineList((req.query.q || '').trim(), n(req.query.category_id))));
router.get('/stock/low', auth, allow('Warehouse Manager', 'Warehouse Worker', 'Admin'), async (req, res) =>
  res.json((await medicineList('', null)).filter(m => m.low_stock)));

async function validMedicine(res, b) {
  if (!req_(res, b, ['name', 'category_id'])) return false;
  if (b.low_stock_limit !== undefined && b.low_stock_limit !== null && b.low_stock_limit !== '' && !(Number(b.low_stock_limit) >= 0)) { bad(res, 'Low stock limit must be 0 or more'); return false; }
  const c = await db.get('SELECT active FROM categories WHERE id=?', [b.category_id]);
  if (!c) { bad(res, 'Category not found'); return false; }
  return true;
}
router.post('/medicines', auth, allow('Warehouse Manager'), async (req, res) => {
  const b = req.body;
  if (!(await validMedicine(res, b))) return;
  const r = await db.run('INSERT INTO medicines(name,category_id,unit,low_stock_limit,description) VALUES(?,?,?,?,?)',
    [b.name, b.category_id, b.unit || 'units', n(b.low_stock_limit), n(b.description)]);
  await db.run('INSERT INTO inventory(medicine_id,quantity) VALUES(?,0)', [r.id]);
  await log(req.user, 'CREATE_MEDICINE', b.name);
  res.json({ id: r.id });
});
router.put('/medicines/:id', auth, allow('Warehouse Manager'), async (req, res) => {
  const m = await db.get('SELECT * FROM medicines WHERE id=?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Medicine not found' });
  const b = { ...m, ...req.body };
  if (!(await validMedicine(res, b))) return;
  await db.run('UPDATE medicines SET name=?,category_id=?,unit=?,low_stock_limit=?,description=?,active=? WHERE id=?',
    [b.name, b.category_id, b.unit || 'units', n(b.low_stock_limit), n(b.description), flag(b.active), m.id]);
  await log(req.user, 'UPDATE_MEDICINE', b.name);
  res.json({ ok: true });
});

// ---------- settings & audit log (FR-23) ----------
router.get('/settings', auth, async (req, res) =>
  res.json(Object.fromEntries((await db.all('SELECT setting_key,setting_value FROM settings')).map(r => [r.setting_key, r.setting_value]))));
router.put('/settings', auth, allow('Admin'), async (req, res) => {
  const b = req.body;
  if (!String(b.warehouse_name || '').trim()) return bad(res, 'Warehouse name is required');
  if (!(Number(b.default_low_stock_limit) >= 0) || !(Number(b.expiry_alert_days) >= 0)) return bad(res, 'Limits must be numbers 0 or more');
  for (const k of ['warehouse_name', 'default_low_stock_limit', 'expiry_alert_days'])
    await db.run('INSERT INTO settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [k, String(b[k])]);
  await log(req.user, 'UPDATE_SETTINGS', JSON.stringify(b));
  res.json({ ok: true });
});
router.get('/audit-log', auth, allow('Admin'), async (req, res) =>
  res.json(await db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300')));

module.exports = router;
