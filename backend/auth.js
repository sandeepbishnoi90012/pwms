const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'pwms-academic-secret';

const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '8h' });

// authenticate: verifies token, loads the active user from the DB
async function auth(req, res, next) {
  const { db } = require('./db');
  const h = req.headers.authorization || '';
  let id;
  try { ({ id } = jwt.verify(h.replace('Bearer ', ''), SECRET)); }
  catch { return res.status(401).json({ error: 'Please log in' }); }
  const u = await db.get('SELECT id,name,email,role,supplier_id,active FROM users WHERE id=?', [id]);
  if (!u || !u.active) return res.status(401).json({ error: 'Account inactive or not found' });
  req.user = u; next();
}
// authorize: role-based access control (FR-02)
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Your role is not allowed to do this' });

module.exports = { sign, auth, allow };
