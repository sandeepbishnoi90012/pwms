// Purchases, purchase orders, supplier responses
const router = require('express').Router();
const { db, tx, log } = require('../db');
const { auth, allow } = require('../auth');
const bad = (res, msg) => res.status(400).json({ error: msg });

const latestPO = (pid, x = db) => x.get('SELECT * FROM purchase_orders WHERE purchase_id=? ORDER BY id DESC LIMIT 1', [pid]);
const SELECT_PURCHASE = `SELECT p.*,m.name medicine_name,s.name supplier_name,u.name created_by_name,
  (SELECT status FROM purchase_orders o WHERE o.purchase_id=p.id ORDER BY o.id DESC LIMIT 1) po_status,
  (SELECT po_number FROM purchase_orders o WHERE o.purchase_id=p.id ORDER BY o.id DESC LIMIT 1) po_number,
  CAST(COALESCE((SELECT SUM(received_quantity) FROM batches b WHERE b.purchase_id=p.id),0) AS SIGNED) received_quantity
  FROM purchases p JOIN medicines m ON m.id=p.medicine_id LEFT JOIN suppliers s ON s.id=p.supplier_id
  LEFT JOIN users u ON u.id=p.created_by`;

// ---- purchases (FR-12) ----
router.get('/purchases', auth, allow('Warehouse Manager', 'Admin'), async (req, res) =>
  res.json(await db.all(SELECT_PURCHASE + ' ORDER BY p.id DESC')));

// purchases a worker can receive against (FR-15)
router.get('/purchases/receivable', auth, allow('Warehouse Worker', 'Warehouse Manager'), async (req, res) =>
  res.json(await db.all(SELECT_PURCHASE + ` WHERE p.status IN ('Ordered','Partially Received')
    AND (SELECT status FROM purchase_orders o WHERE o.purchase_id=p.id ORDER BY o.id DESC LIMIT 1)='Accepted' ORDER BY p.id`)));

async function checkPurchase(res, b) {
  if (!b.medicine_id) { bad(res, 'Medicine is required'); return false; }
  if (!Number.isInteger(Number(b.quantity)) || Number(b.quantity) <= 0) { bad(res, 'Quantity must be a whole number greater than zero'); return false; }
  if (!(await db.get('SELECT 1 x FROM medicines WHERE id=? AND active=1', [b.medicine_id]))) { bad(res, 'Medicine not found or inactive'); return false; }
  return true;
}
router.post('/purchases', auth, allow('Warehouse Manager'), async (req, res) => {
  const b = req.body;
  if (!(await checkPurchase(res, b))) return;
  const r = await db.run('INSERT INTO purchases(medicine_id,supplier_id,quantity,notes,created_by) VALUES(?,?,?,?,?)',
    [b.medicine_id, b.supplier_id || null, Number(b.quantity), b.notes || null, req.user.id]);
  await log(req.user, 'CREATE_PURCHASE', `purchase #${r.id}`);
  res.json({ id: r.id });
});
router.put('/purchases/:id', auth, allow('Warehouse Manager'), async (req, res) => {
  const p = await db.get('SELECT * FROM purchases WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Purchase not found' });
  const po = await latestPO(p.id);
  const editable = p.status === 'Draft' || (p.status === 'Ordered' && po && po.status !== 'Accepted');
  if (!editable) return bad(res, `A purchase that is "${p.status}"${po ? ` with order ${po.status}` : ''} can no longer be edited`);
  const b = { ...p, ...req.body };
  if (!(await checkPurchase(res, b))) return;
  await db.run('UPDATE purchases SET medicine_id=?,supplier_id=?,quantity=?,notes=? WHERE id=?',
    [b.medicine_id, b.supplier_id || null, Number(b.quantity), b.notes || null, p.id]);
  await log(req.user, 'UPDATE_PURCHASE', `purchase #${p.id}`);
  res.json({ ok: true });
});
router.post('/purchases/:id/cancel', auth, allow('Warehouse Manager'), async (req, res) => {
  const p = await db.get('SELECT * FROM purchases WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Purchase not found' });
  if (!['Draft', 'Ordered'].includes(p.status)) return bad(res, `A "${p.status}" purchase cannot be cancelled`);
  await tx(async t => {
    await t.run("UPDATE purchases SET status='Cancelled' WHERE id=?", [p.id]);
    await t.run("UPDATE purchase_orders SET status='Cancelled' WHERE purchase_id=? AND status IN ('Sent','Change Proposed')", [p.id]);
  });
  await log(req.user, 'CANCEL_PURCHASE', `purchase #${p.id}`);
  res.json({ ok: true });
});

// ---- generate & send purchase order (FR-13) ----
router.post('/purchases/:id/send-po', auth, allow('Warehouse Manager'), async (req, res) => {
  const p = await db.get('SELECT * FROM purchases WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Purchase not found' });
  const sid = req.body.supplier_id || p.supplier_id;
  if (!sid) return bad(res, 'Select a supplier');
  const sup = await db.get('SELECT * FROM suppliers WHERE id=? AND active=1', [sid]);
  if (!sup) return bad(res, 'Supplier not found or inactive');
  const po = await latestPO(p.id);
  const canSend = p.status === 'Draft' || (p.status === 'Ordered' && po && ['Rejected', 'Change Proposed'].includes(po.status));
  if (!canSend) return bad(res, 'A purchase order cannot be sent for this purchase right now');
  const out = await tx(async t => {
    if (po && po.status === 'Change Proposed') await t.run("UPDATE purchase_orders SET status='Superseded' WHERE id=?", [po.id]);
    const cnt = Number((await t.get('SELECT COUNT(*) c FROM purchase_orders WHERE purchase_id=?', [p.id])).c);
    const num = 'PO-' + new Date().getFullYear() + '-' + String(p.id).padStart(4, '0') + '-' + String(cnt + 1);
    await t.run('UPDATE purchases SET supplier_id=?,status=? WHERE id=?', [sup.id, 'Ordered', p.id]);
    const r = await t.run("INSERT INTO purchase_orders(po_number,purchase_id,supplier_id,status) VALUES(?,?,?, 'Sent')", [num, p.id, sup.id]);
    return { id: r.id, po_number: num };
  });
  await log(req.user, 'SEND_PO', `${out.po_number} to ${sup.name}`);
  res.json(out);
});

// ---- purchase orders list ----
router.get('/orders', auth, allow('Supplier', 'Warehouse Manager', 'Warehouse Worker', 'Admin'), async (req, res) => {
  let where = '1=1', args = [];
  if (req.user.role === 'Supplier') { where = 'o.supplier_id=?'; args = [req.user.supplier_id]; }
  res.json(await db.all(`SELECT o.*,p.quantity,p.notes,p.status purchase_status,m.name medicine_name,m.unit,s.name supplier_name,
    (SELECT price FROM offers f WHERE f.supplier_id=o.supplier_id AND f.medicine_id=p.medicine_id AND f.active=1 ORDER BY f.id DESC LIMIT 1) offer_price
    FROM purchase_orders o JOIN purchases p ON p.id=o.purchase_id JOIN medicines m ON m.id=p.medicine_id
    JOIN suppliers s ON s.id=o.supplier_id WHERE ${where} ORDER BY o.id DESC`, args));
});

// ---- supplier responds (FR-14): accept / reject / propose change ----
router.post('/orders/:id/respond', auth, allow('Supplier'), async (req, res) => {
  const o = await db.get('SELECT * FROM purchase_orders WHERE id=? AND supplier_id=?', [req.params.id, req.user.supplier_id]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (o.status !== 'Sent') return bad(res, `This order is already "${o.status}"`);
  const { action, quantity, note } = req.body;
  let status, pq = null;
  if (action === 'accept') status = 'Accepted';
  else if (action === 'reject') status = 'Rejected';
  else if (action === 'propose') {
    pq = Number(quantity);
    if (!Number.isInteger(pq) || pq <= 0) return bad(res, 'Enter the proposed quantity');
    if (!String(note || '').trim()) return bad(res, 'Please explain the proposed change');
    status = 'Change Proposed';
  } else return bad(res, 'Invalid action');
  await db.run('UPDATE purchase_orders SET status=?,proposed_quantity=?,supplier_note=?,responded_at=CURRENT_TIMESTAMP WHERE id=?',
    [status, pq, note || null, o.id]);
  await log(req.user, 'RESPOND_PO', `${o.po_number}: ${status}`);
  res.json({ status });
});

// manager handles a supplier's change proposal
router.post('/orders/:id/resolve', auth, allow('Warehouse Manager'), async (req, res) => {
  const o = await db.get('SELECT * FROM purchase_orders WHERE id=?', [req.params.id]);
  if (!o || o.status !== 'Change Proposed') return bad(res, 'No change proposal to resolve');
  if (req.body.accept) {
    await tx(async t => {
      await t.run('UPDATE purchases SET quantity=? WHERE id=?', [o.proposed_quantity, o.purchase_id]);
      await t.run("UPDATE purchase_orders SET status='Accepted' WHERE id=?", [o.id]);
    });
    await log(req.user, 'ACCEPT_PROPOSAL', o.po_number);
  } else {
    await db.run("UPDATE purchase_orders SET status='Rejected' WHERE id=?", [o.id]);
    await log(req.user, 'REJECT_PROPOSAL', o.po_number);
  }
  res.json({ ok: true });
});

module.exports = router;
