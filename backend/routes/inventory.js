// Batches, receiving, stock view, dashboard
const router = require('express').Router();
const { db, tx, log, getSetting, recalcStock } = require('../db');
const { auth, allow } = require('../auth');
const bad = (res, msg) => res.status(400).json({ error: msg });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));

// batches + expiry details (FR-10)
router.get('/batches', auth, allow('Admin', 'Warehouse Manager', 'Warehouse Worker'), async (req, res) => {
  const mid = req.query.medicine_id || null;
  const days = Number(await getSetting('expiry_alert_days', 60));
  const rows = await db.all(`SELECT b.*,m.name medicine_name,u.name received_by_name,
      DATEDIFF(b.expiry_date, CURDATE()) days_to_expiry
    FROM batches b JOIN medicines m ON m.id=b.medicine_id LEFT JOIN users u ON u.id=b.received_by
    WHERE (? IS NULL OR b.medicine_id=?) ORDER BY b.expiry_date`, [mid, mid]);
  res.json(rows.map(b => ({ ...b, expiry_status: b.days_to_expiry < 0 ? 'Expired' : b.days_to_expiry <= days ? 'Expiring soon' : 'OK' })));
});

// receive a batch (FR-07, FR-08, FR-09, FR-15, FR-16); purchase_id optional
router.post('/batches', auth, allow('Warehouse Worker'), async (req, res) => {
  const b = req.body;
  const qty = Number(b.quantity);
  if (!b.medicine_id || !String(b.batch_no || '').trim()) return bad(res, 'Medicine and batch number are required');
  if (!Number.isInteger(qty) || qty <= 0) return bad(res, 'Quantity must be a whole number greater than zero');
  if (!isDate(b.mfg_date) || !isDate(b.expiry_date)) return bad(res, 'Manufacturing and expiry dates are required');
  if (b.expiry_date < b.mfg_date) return bad(res, 'Expiry date cannot be earlier than the manufacturing date');
  if (b.expiry_date < new Date().toISOString().slice(0, 10)) return bad(res, 'This batch is already expired and cannot be received');
  const med = await db.get('SELECT * FROM medicines WHERE id=? AND active=1', [b.medicine_id]);
  if (!med) return bad(res, 'Medicine not found or inactive');
  if (await db.get('SELECT 1 x FROM batches WHERE medicine_id=? AND batch_no=?', [med.id, b.batch_no.trim()]))
    return bad(res, 'This batch number already exists for the medicine');

  try {
    const out = await tx(async t => {
      let purchase = null;
      if (b.purchase_id) {
        purchase = await t.get('SELECT * FROM purchases WHERE id=?', [b.purchase_id]);
        if (!purchase || !['Ordered', 'Partially Received'].includes(purchase.status)) throw new Error('This purchase is not open for receiving');
        const po = await t.get('SELECT status FROM purchase_orders WHERE purchase_id=? ORDER BY id DESC LIMIT 1', [purchase.id]);
        if (!po || po.status !== 'Accepted') throw new Error('The supplier has not accepted this purchase order yet');
        if (purchase.medicine_id !== med.id) throw new Error('Medicine does not match the purchase');
      }
      const r = await t.run('INSERT INTO batches(medicine_id,batch_no,quantity,received_quantity,mfg_date,expiry_date,purchase_id,received_by) VALUES(?,?,?,?,?,?,?,?)',
        [med.id, b.batch_no.trim(), qty, qty, b.mfg_date, b.expiry_date, purchase ? purchase.id : null, req.user.id]);
      const stock = await recalcStock(med.id, t);
      let status = null;
      if (purchase) {
        const { got } = await t.get('SELECT SUM(received_quantity) got FROM batches WHERE purchase_id=?', [purchase.id]);
        status = got >= purchase.quantity ? 'Completed' : 'Partially Received';
        await t.run('UPDATE purchases SET status=? WHERE id=?', [status, purchase.id]);
      }
      await log(req.user, 'RECEIVE_BATCH', `${med.name} batch ${b.batch_no} qty ${qty}${purchase ? ` (purchase #${purchase.id} -> ${status})` : ''}`, t);
      return { id: r.id, stock, purchase_status: status };
    });
    res.json(out);
  } catch (e) { bad(res, e.message); }
});

// dashboard counts per role
router.get('/dashboard', auth, async (req, res) => {
  const c = async (sql, p) => Number((await db.get(sql, p)).c);
  const u = req.user, out = {};
  if (u.role === 'Supplier') {
    out['Orders awaiting my response'] = await c("SELECT COUNT(*) c FROM purchase_orders WHERE supplier_id=? AND status='Sent'", [u.supplier_id]);
    out['My active offers'] = await c('SELECT COUNT(*) c FROM offers WHERE supplier_id=? AND active=1', [u.supplier_id]);
    return res.json(out);
  }
  out['Medicines'] = await c('SELECT COUNT(*) c FROM medicines WHERE active=1');
  out['Total units in stock'] = await c('SELECT COALESCE(SUM(quantity),0) c FROM inventory');
  const def = Number(await getSetting('default_low_stock_limit', 100));
  out['Low-stock medicines'] = await c(`SELECT COUNT(*) c FROM medicines m LEFT JOIN inventory i ON i.medicine_id=m.id WHERE m.active=1 AND COALESCE(i.quantity,0)<COALESCE(NULLIF(m.low_stock_limit,0),${def})`);
  const days = Number(await getSetting('expiry_alert_days', 60));
  out['Batches expiring soon'] = await c(`SELECT COUNT(*) c FROM batches WHERE quantity>0 AND expiry_date>=CURDATE() AND expiry_date<=DATE_ADD(CURDATE(), INTERVAL ${days} DAY)`);
  if (u.role === 'Admin') { out['Users'] = await c('SELECT COUNT(*) c FROM users WHERE active=1'); out['Suppliers'] = await c('SELECT COUNT(*) c FROM suppliers WHERE active=1'); }
  if (u.role === 'Warehouse Manager') {
    out['Pending return reports'] = await c("SELECT COUNT(*) c FROM return_reports WHERE status='Pending'");
    out['Open purchases'] = await c("SELECT COUNT(*) c FROM purchases WHERE status IN ('Draft','Ordered','Partially Received')");
    out['Audit adjustments to review'] = await c("SELECT COUNT(*) c FROM audit_items WHERE adjustment_status='Pending' AND physical_qty IS NOT NULL AND difference<>0");
  }
  if (u.role === 'Warehouse Worker') out['Purchases to receive'] = await c("SELECT COUNT(*) c FROM purchases p WHERE status IN ('Ordered','Partially Received') AND EXISTS(SELECT 1 FROM purchase_orders o WHERE o.purchase_id=p.id AND o.status='Accepted')");
  res.json(out);
});

module.exports = router;
