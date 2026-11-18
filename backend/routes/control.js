// Damaged/returned reports and stock audits
const router = require('express').Router();
const { db, tx, log, recalcStock } = require('../db');
const { auth, allow } = require('../auth');
const bad = (res, msg) => res.status(400).json({ error: msg });

// ---- damaged / returned medicine reports (FR-17..19) ----
router.get('/returns', auth, allow('Warehouse Manager', 'Warehouse Worker', 'Admin'), async (req, res) => {
  const own = req.user.role === 'Warehouse Worker' ? req.user.id : null;
  res.json(await db.all(`SELECT r.*,b.batch_no,b.quantity batch_quantity,m.name medicine_name,u.name reported_by_name,v.name reviewed_by_name
    FROM return_reports r JOIN batches b ON b.id=r.batch_id JOIN medicines m ON m.id=b.medicine_id
    JOIN users u ON u.id=r.reported_by LEFT JOIN users v ON v.id=r.reviewed_by
    WHERE (? IS NULL OR r.reported_by=?) ORDER BY r.id DESC`, [own, own]));
});
router.post('/returns', auth, allow('Warehouse Worker'), async (req, res) => {
  const { batch_id, type, quantity, reason } = req.body;
  const q = Number(quantity);
  const b = await db.get('SELECT * FROM batches WHERE id=?', [batch_id]);
  if (!b) return bad(res, 'Select a batch');
  if (!['Damaged', 'Returned'].includes(type)) return bad(res, 'Type must be Damaged or Returned');
  if (!Number.isInteger(q) || q <= 0) return bad(res, 'Quantity must be a whole number greater than zero');
  if (!String(reason || '').trim()) return bad(res, 'Reason is required');
  const pending = Number((await db.get("SELECT COALESCE(SUM(quantity),0) s FROM return_reports WHERE batch_id=? AND status='Pending'", [b.id])).s);
  if (q + pending > b.quantity) return bad(res, `Only ${b.quantity - pending} units of this batch are available to report`);
  const r = await db.run('INSERT INTO return_reports(batch_id,type,quantity,reason,reported_by) VALUES(?,?,?,?,?)',
    [b.id, type, q, reason.trim(), req.user.id]);
  await log(req.user, 'REPORT_' + type.toUpperCase(), `batch ${b.batch_no} qty ${q}`);
  res.json({ id: r.id });
});
router.post('/returns/:id/review', auth, allow('Warehouse Manager'), async (req, res) => {
  const r = await db.get('SELECT * FROM return_reports WHERE id=?', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (r.status !== 'Pending') return bad(res, `Report is already ${r.status}`);
  if (r.reported_by === req.user.id) return bad(res, 'You cannot approve your own report'); // security rule
  const approve = req.body.decision === 'approve';
  if (!approve && req.body.decision !== 'reject') return bad(res, 'Decision must be approve or reject');
  try {
    await tx(async t => {
      if (approve) {
        const b = await t.get('SELECT * FROM batches WHERE id=? FOR UPDATE', [r.batch_id]);
        if (b.quantity < r.quantity) throw new Error('Batch no longer has enough stock for this report');
        await t.run('UPDATE batches SET quantity=quantity-? WHERE id=?', [r.quantity, b.id]);
        await recalcStock(b.medicine_id, t); // stock changes only after approval
      }
      await t.run('UPDATE return_reports SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?',
        [approve ? 'Approved' : 'Rejected', req.user.id, r.id]);
    });
  } catch (e) { return bad(res, e.message); }
  await log(req.user, approve ? 'APPROVE_RETURN' : 'REJECT_RETURN', `report #${r.id}`);
  res.json({ ok: true });
});

// ---- stock audits (FR-20..22) ----
router.get('/audits', auth, allow('Warehouse Manager', 'Warehouse Worker', 'Admin'), async (req, res) =>
  res.json(await db.all(`SELECT a.*,u.name started_by_name,
    (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id=a.id) item_count,
    (SELECT COUNT(*) FROM audit_items i WHERE i.audit_id=a.id AND i.physical_qty IS NOT NULL) counted
    FROM stock_audits a LEFT JOIN users u ON u.id=a.started_by ORDER BY a.id DESC`)));
router.get('/audits/:id', auth, allow('Warehouse Manager', 'Warehouse Worker', 'Admin'), async (req, res) => {
  const a = await db.get('SELECT * FROM stock_audits WHERE id=?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'Audit not found' });
  const items = await db.all(`SELECT i.*,m.name medicine_name FROM audit_items i JOIN medicines m ON m.id=i.medicine_id
    WHERE i.audit_id=? ORDER BY m.name`, [a.id]);
  res.json({ ...a, items });
});
router.post('/audits', auth, allow('Warehouse Manager'), async (req, res) => {
  if (await db.get("SELECT 1 x FROM stock_audits WHERE status IN ('Open','Counted')")) return bad(res, 'Finish the current audit before starting a new one');
  const out = await tx(async t => {
    const r = await t.run('INSERT INTO stock_audits(started_by) VALUES(?)', [req.user.id]);
    const meds = await t.all('SELECT m.id,COALESCE(i.quantity,0) q FROM medicines m LEFT JOIN inventory i ON i.medicine_id=m.id WHERE m.active=1');
    for (const m of meds) await t.run('INSERT INTO audit_items(audit_id,medicine_id,recorded_qty) VALUES(?,?,?)', [r.id, m.id, m.q]);
    return { id: r.id };
  });
  await log(req.user, 'START_AUDIT', `audit #${out.id}`);
  res.json(out);
});
// worker enters physical counts; difference = physical - recorded
router.post('/audits/:id/count', auth, allow('Warehouse Worker'), async (req, res) => {
  const a = await db.get('SELECT * FROM stock_audits WHERE id=?', [req.params.id]);
  if (!a || a.status !== 'Open') return bad(res, 'This audit is not open for counting');
  const items = req.body.items || [];
  for (const it of items) if (!Number.isInteger(Number(it.physical_qty)) || Number(it.physical_qty) < 0 || it.physical_qty === '' || it.physical_qty === null)
    return bad(res, 'Counts must be whole numbers, 0 or more');
  await tx(async t => {
    for (const it of items) {
      const q = Number(it.physical_qty);
      const row = await t.get('SELECT recorded_qty FROM audit_items WHERE id=? AND audit_id=?', [it.id, a.id]);
      if (!row) continue;
      await t.run('UPDATE audit_items SET physical_qty=?,difference=?,adjustment_status=? WHERE id=? AND audit_id=?',
        [q, q - row.recorded_qty, q === row.recorded_qty ? 'No change' : 'Pending', it.id, a.id]);
    }
  });
  await log(req.user, 'ENTER_COUNTS', `audit #${a.id}`);
  res.json({ ok: true });
});
router.post('/audits/:id/submit', auth, allow('Warehouse Worker'), async (req, res) => {
  const a = await db.get('SELECT * FROM stock_audits WHERE id=?', [req.params.id]);
  if (!a || a.status !== 'Open') return bad(res, 'This audit is not open');
  if (await db.get('SELECT 1 x FROM audit_items WHERE audit_id=? AND physical_qty IS NULL', [a.id])) return bad(res, 'Enter the physical count for every medicine first');
  await db.run("UPDATE stock_audits SET status='Counted' WHERE id=?", [a.id]);
  await closeIfDone(a.id);
  await log(req.user, 'SUBMIT_AUDIT', `audit #${a.id}`);
  res.json({ ok: true });
});
async function closeIfDone(auditId, x = db) {
  if (!(await x.get("SELECT 1 x FROM audit_items WHERE audit_id=? AND adjustment_status='Pending'", [auditId])))
    await x.run("UPDATE stock_audits SET status='Completed',closed_at=CURRENT_TIMESTAMP WHERE id=? AND status='Counted'", [auditId]);
}
// manager approves/rejects each adjustment; stock changes only on approval
router.post('/audits/:id/items/:itemId/decision', auth, allow('Warehouse Manager'), async (req, res) => {
  const a = await db.get('SELECT * FROM stock_audits WHERE id=?', [req.params.id]);
  const it = await db.get('SELECT * FROM audit_items WHERE id=? AND audit_id=?', [req.params.itemId, req.params.id]);
  if (!a || !it) return res.status(404).json({ error: 'Audit item not found' });
  if (a.status !== 'Counted') return bad(res, 'Counts have not been submitted yet');
  if (it.adjustment_status !== 'Pending') return bad(res, `Adjustment already ${it.adjustment_status}`);
  const approve = req.body.decision === 'approve';
  if (!approve && req.body.decision !== 'reject') return bad(res, 'Decision must be approve or reject');
  try {
    await tx(async t => {
      if (approve) {
        const cur = await t.get('SELECT COALESCE(quantity,0) q FROM inventory WHERE medicine_id=?', [it.medicine_id]);
        // apply the difference measured at count time relative to the current stock
        let diff = it.physical_qty - (cur ? cur.q : 0);
        if (diff < 0) { // remove from earliest-expiring batches first
          for (const b of await t.all('SELECT * FROM batches WHERE medicine_id=? AND quantity>0 ORDER BY expiry_date', [it.medicine_id])) {
            if (diff === 0) break;
            const take = Math.min(b.quantity, -diff);
            await t.run('UPDATE batches SET quantity=quantity-? WHERE id=?', [take, b.id]);
            diff += take;
          }
        } else if (diff > 0) {
          const b = await t.get('SELECT * FROM batches WHERE medicine_id=? ORDER BY expiry_date DESC LIMIT 1', [it.medicine_id]);
          if (!b) throw new Error('No batch exists to add the surplus to; receive a batch first');
          await t.run('UPDATE batches SET quantity=quantity+? WHERE id=?', [diff, b.id]);
        }
        await recalcStock(it.medicine_id, t);
      }
      await t.run('UPDATE audit_items SET adjustment_status=? WHERE id=?', [approve ? 'Approved' : 'Rejected', it.id]);
      await closeIfDone(a.id, t);
    });
  } catch (e) { return bad(res, e.message); }
  await log(req.user, approve ? 'APPROVE_ADJUSTMENT' : 'REJECT_ADJUSTMENT', `audit #${a.id} item ${it.id} (${it.difference > 0 ? '+' : ''}${it.difference})`);
  res.json({ ok: true });
});

module.exports = router;
