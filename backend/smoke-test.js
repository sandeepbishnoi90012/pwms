// Quick end-to-end API test: run with  node server/smoke-test.js  (server must be running)
const B = (process.env.API_URL || 'http://localhost:5000/api');
let pass = 0, fail = 0;
async function call(tok, m, u, b) {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
}
const ok = (name, c, extra) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + JSON.stringify(extra))); };
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).d.token;

(async () => {
  const bad = await call(null, 'POST', '/auth/login', { email: 'admin@pwms.com', password: 'x' });
  ok('FR-01 bad login rejected', bad.s === 401);
  const A = await login('admin@pwms.com', 'admin123'), M = await login('manager@pwms.com', 'manager123'),
    W = await login('worker@pwms.com', 'worker123'), S = await login('supplier@pwms.com', 'supplier123'), S2 = await login('supplier2@pwms.com', 'supplier123');
  ok('login all roles', A && M && W && S && S2);
  ok('FR-02 no token blocked', (await call(null, 'GET', '/medicines')).s === 401);
  ok('FR-02 worker cannot list users', (await call(W, 'GET', '/users')).s === 403);
  ok('FR-02 supplier cannot see purchases', (await call(S, 'GET', '/purchases')).s === 403);

  const u = await call(A, 'POST', '/users', { name: 'T', email: 't' + Date.now() + '@x.com', password: 'secret1', role: 'Warehouse Worker' });
  ok('FR-03 admin creates user', u.s === 200, u.d);
  ok('FR-03 admin deactivates user', (await call(A, 'PUT', '/users/' + u.d.id, { active: false })).s === 200);
  const sp = await call(A, 'POST', '/suppliers', { name: 'Test Sup' }); ok('FR-04 admin creates supplier', sp.s === 200);
  ok('FR-04 supplier updates own profile', (await call(S, 'PUT', '/supplier/me', { name: 'MediSupply Co.', phone: '123' })).s === 200);
  const off = await call(S, 'POST', '/offers', { medicine_id: 2, price: 10 }); ok('FR-04 supplier creates offer', off.s === 200);
  ok('Supplier cannot edit another supplier offer', (await call(S2, 'PUT', '/offers/' + off.d.id, { price: 1 })).s === 404);
  const cat = await call(A, 'POST', '/categories', { name: 'Cat' + Date.now() }); ok('FR-05 admin creates category', cat.s === 200);
  ok('FR-05 manager cannot create category', (await call(M, 'POST', '/categories', { name: 'zz' })).s === 403);
  const med = await call(M, 'POST', '/medicines', { name: 'TestMed' + Date.now(), category_id: cat.d.id, low_stock_limit: 50 }); ok('FR-05 manager creates medicine', med.s === 200, med.d);
  const s1 = await call(W, 'GET', '/medicines?q=Paracetamol'); ok('FR-06 search by name', s1.d.length === 1);
  const s2 = await call(W, 'GET', '/medicines?q=Antibiotics'); ok('FR-06 search by category', s2.d.length === 2);

  const mid = med.d.id;
  const bd = await call(W, 'POST', '/batches', { medicine_id: mid, batch_no: 'T1', quantity: 10, mfg_date: '2026-05-01', expiry_date: '2026-01-01' });
  ok('FR-08 expiry<mfg rejected', bd.s === 400 && /earlier/.test(bd.d.error), bd.d);
  const bg = await call(W, 'POST', '/batches', { medicine_id: mid, batch_no: 'T1', quantity: 10, mfg_date: '2026-01-01', expiry_date: '2030-01-01' });
  ok('FR-07/09 batch received, stock=10', bg.s === 200 && bg.d.stock === 10, bg.d);
  ok('duplicate batch rejected', (await call(W, 'POST', '/batches', { medicine_id: mid, batch_no: 'T1', quantity: 1, mfg_date: '2026-01-01', expiry_date: '2030-01-01' })).s === 400);
  ok('FR-11 new med (10<50) is low stock', (await call(M, 'GET', '/stock/low')).d.some(x => x.id === mid));

  // purchase flow
  const pu = await call(M, 'POST', '/purchases', { medicine_id: mid, quantity: 100 }); ok('FR-12 create purchase', pu.s === 200);
  ok('FR-12 update purchase', (await call(M, 'PUT', '/purchases/' + pu.d.id, { quantity: 80 })).s === 200);
  const po = await call(M, 'POST', `/purchases/${pu.d.id}/send-po`, { supplier_id: 1 }); ok('FR-13 send PO', po.s === 200, po.d);
  ok('FR-14 supplier2 cannot see/respond to others PO', (await call(S2, 'POST', `/orders/${po.d.id}/respond`, { action: 'accept' })).s === 404);
  ok('receive blocked before acceptance', (await call(W, 'POST', '/batches', { medicine_id: mid, batch_no: 'P0', quantity: 5, mfg_date: '2026-01-01', expiry_date: '2030-01-01', purchase_id: pu.d.id })).s === 400);
  const pr = await call(S, 'POST', `/orders/${po.d.id}/respond`, { action: 'propose', quantity: 60, note: 'Stock limited' }); ok('FR-14 propose change', pr.d.status === 'Change Proposed', pr.d);
  ok('manager accepts proposal', (await call(M, 'POST', `/orders/${po.d.id}/resolve`, { accept: true })).s === 200);
  const r1 = await call(W, 'POST', '/batches', { medicine_id: mid, batch_no: 'P1', quantity: 40, mfg_date: '2026-01-01', expiry_date: '2030-01-01', purchase_id: pu.d.id });
  ok('FR-15/16 partial receive -> Partially Received', r1.d.purchase_status === 'Partially Received', r1.d);
  const r2 = await call(W, 'POST', '/batches', { medicine_id: mid, batch_no: 'P2', quantity: 20, mfg_date: '2026-01-01', expiry_date: '2030-01-01', purchase_id: pu.d.id });
  ok('FR-16 full receive -> Completed, stock 70', r2.d.purchase_status === 'Completed' && r2.d.stock === 70, r2.d);
  const pu2 = await call(M, 'POST', '/purchases', { medicine_id: mid, quantity: 5 });
  ok('FR-12 cancel purchase', (await call(M, 'POST', `/purchases/${pu2.d.id}/cancel`)).s === 200);

  // returns
  const bs = (await call(W, 'GET', '/batches?medicine_id=' + mid)).d; const b1 = bs.find(x => x.batch_no === 'P1');
  const rt = await call(W, 'POST', '/returns', { batch_id: b1.id, type: 'Damaged', quantity: 15, reason: 'Broken' }); ok('FR-17 report damaged', rt.s === 200, rt.d);
  ok('FR-19 stock unchanged before approval', (await call(M, 'GET', '/medicines?q=TestMed')).d.find(x => x.id === mid).stock === 70);
  ok('worker cannot approve', (await call(W, 'POST', `/returns/${rt.d.id}/review`, { decision: 'approve' })).s === 403);
  ok('FR-18 manager approves', (await call(M, 'POST', `/returns/${rt.d.id}/review`, { decision: 'approve' })).s === 200);
  ok('FR-19 stock reduced to 55', (await call(M, 'GET', '/medicines?q=TestMed')).d.find(x => x.id === mid).stock === 55);
  const rt2 = await call(W, 'POST', '/returns', { batch_id: b1.id, type: 'Returned', quantity: 5, reason: 'x' });
  ok('FR-18 reject keeps stock', (await call(M, 'POST', `/returns/${rt2.d.id}/review`, { decision: 'reject' })).s === 200 && (await call(M, 'GET', '/medicines?q=TestMed')).d.find(x => x.id === mid).stock === 55);

  // audit
  const au = await call(M, 'POST', '/audits'); ok('FR-20 start audit', au.s === 200, au.d);
  ok('only one open audit', (await call(M, 'POST', '/audits')).s === 400);
  let det = (await call(W, 'GET', '/audits/' + au.d.id)).d;
  const item = det.items.find(i => i.medicine_id === mid), item2 = det.items.find(i => i.medicine_id === 1);
  ok('submit blocked until all counted', (await call(W, 'POST', `/audits/${au.d.id}/submit`)).s === 400);
  const counts = det.items.map(i => ({ id: i.id, physical_qty: i.id === item.id ? 50 : i.id === item2.id ? 125 : i.recorded_qty }));
  ok('FR-20 enter counts', (await call(W, 'POST', `/audits/${au.d.id}/count`, { items: counts })).s === 200);
  det = (await call(W, 'GET', '/audits/' + au.d.id)).d;
  ok('FR-21 difference -5 and +5', det.items.find(i => i.id === item.id).difference === -5 && det.items.find(i => i.id === item2.id).difference === 5);
  ok('submit counts', (await call(W, 'POST', `/audits/${au.d.id}/submit`)).s === 200);
  ok('FR-22 stock unchanged before approval', (await call(M, 'GET', '/medicines?q=TestMed')).d.find(x => x.id === mid).stock === 55);
  ok('FR-22 approve -5', (await call(M, 'POST', `/audits/${au.d.id}/items/${item.id}/decision`, { decision: 'approve' })).s === 200);
  ok('FR-22 stock now 50', (await call(M, 'GET', '/medicines?q=TestMed')).d.find(x => x.id === mid).stock === 50);
  ok('FR-22 reject +5 keeps stock 120', (await call(M, 'POST', `/audits/${au.d.id}/items/${item2.id}/decision`, { decision: 'reject' })).s === 200 && (await call(M, 'GET', '/medicines?q=Amoxicillin')).d[0].stock === 120);
  ok('audit auto-completed', (await call(M, 'GET', '/audits/' + au.d.id)).d.status === 'Completed');

  // settings & log
  ok('FR-23 update settings', (await call(A, 'PUT', '/settings', { warehouse_name: 'Central Pharma Warehouse', default_low_stock_limit: 100, expiry_alert_days: 60 })).s === 200);
  ok('FR-23 manager cannot change settings', (await call(M, 'PUT', '/settings', {})).s === 403);
  const lg = await call(A, 'GET', '/audit-log'); ok('FR-23 audit log has entries', lg.d.length > 10);
  ok('dashboards load', (await call(M, 'GET', '/dashboard')).s === 200 && (await call(S, 'GET', '/dashboard')).s === 200);
  console.log(`\n${pass} passed, ${fail} failed`);
})();
