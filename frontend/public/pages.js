// All screens, grouped by sprint
const Pages = {};
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- Dashboard ---------------- */
Pages.Dashboard = () => {
  const [d] = useData('/dashboard');
  const [low] = useData('/stock/low');
  const u = Session.user;
  return html`<div><h1>Dashboard</h1><p className="muted">Welcome, ${u.name}</p>
    ${!d ? 'Loading...' : html`<div className="stats">${Object.entries(d).map(([k, v]) => html`<div className="stat" key=${k}><b>${v}</b><span>${k}</span></div>`)}</div>`}
    ${u.role !== 'Supplier' && low && low.length > 0 && html`<h2>Low-stock medicines</h2>
      <${Table} rows=${low} cols=${[{ h: 'Medicine', f: r => r.name }, { h: 'Category', f: r => r.category_name }, { h: 'Stock', f: r => r.stock },
        { h: 'Limit', f: r => r.effective_limit }, { h: 'Status', f: () => html`<${Badge} t="Low" />` }]} />`}</div>`;
};

/* ---------------- Users (Admin) ---------------- */
Pages.Users = () => {
  const [rows, load] = useData('/users');
  const [sups] = useData('/suppliers');
  const [form, setForm] = useState(null);
  const roles = ['Admin', 'Warehouse Manager', 'Warehouse Worker', 'Supplier'].map(r => ({ v: r, l: r }));
  const fields = edit => [
    { name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'password', label: edit ? 'New password (leave blank to keep)' : 'Password', type: 'password', required: !edit, hint: 'At least 6 characters' },
    { name: 'role', label: 'Role', type: 'select', options: roles, required: true },
    { name: 'supplier_id', label: 'Supplier company', type: 'select', options: opts(sups), showIf: v => v.role === 'Supplier', required: true }];
  return html`<div><h1>Manage Users</h1>
    <div className="bar"><button onClick=${() => setForm({})}>+ New user</button></div>
    <${Table} rows=${rows} cols=${[{ h: 'Name', f: r => r.name }, { h: 'Email', f: r => r.email }, { h: 'Role', f: r => r.role },
      { h: 'Supplier', f: r => r.supplier_name || '-' }, { h: 'Status', f: r => activeBadge(r.active) },
      { h: '', f: r => html`<button className="sm sec" onClick=${() => setForm(r)}>Edit</button>
        <button className=${'sm ' + (r.active ? 'red' : 'blue')} onClick=${() => act(() => PUT('/users/' + r.id, { active: !r.active }), 'User updated', load)}>${r.active ? 'Deactivate' : 'Activate'}</button>` }]} />
    ${form && html`<${FormModal} title=${form.id ? 'Edit user' : 'New user'} fields=${fields(form.id)} initial=${{ ...form, password: '' }}
      onSubmit=${v => form.id ? PUT('/users/' + form.id, { ...v, password: v.password || undefined }) : POST('/users', v)}
      onClose=${ok => { setForm(null); ok && load(); }} />`}</div>`;
};

/* ---------------- Suppliers (Admin / Manager view) ---------------- */
Pages.Suppliers = () => {
  const [rows, load] = useData('/suppliers');
  const [form, setForm] = useState(null);
  const admin = Session.user.role === 'Admin';
  const fields = [{ name: 'name', label: 'Supplier name', required: true }, { name: 'contact_person', label: 'Contact person' },
    { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address', type: 'textarea' }];
  return html`<div><h1>Suppliers</h1>
    ${admin && html`<div className="bar"><button onClick=${() => setForm({})}>+ New supplier</button></div>`}
    <${Table} rows=${rows} cols=${[{ h: 'Name', f: r => r.name }, { h: 'Contact', f: r => r.contact_person }, { h: 'Email', f: r => r.email },
      { h: 'Phone', f: r => r.phone }, { h: 'Address', f: r => r.address }, { h: 'Status', f: r => activeBadge(r.active) },
      ...(admin ? [{ h: '', f: r => html`<button className="sm sec" onClick=${() => setForm(r)}>Edit</button>
        <button className=${'sm ' + (r.active ? 'red' : 'blue')} onClick=${() => act(() => PUT('/suppliers/' + r.id, { active: !r.active }), 'Supplier updated', load)}>${r.active ? 'Deactivate' : 'Activate'}</button>` }] : [])]} />
    ${form && html`<${FormModal} title=${form.id ? 'Edit supplier' : 'New supplier'} fields=${fields} initial=${form}
      onSubmit=${v => form.id ? PUT('/suppliers/' + form.id, v) : POST('/suppliers', v)} onClose=${ok => { setForm(null); ok && load(); }} />`}</div>`;
};

/* ---------------- Supplier: own profile ---------------- */
Pages.Profile = () => {
  const [p, load] = useData('/supplier/me');
  const [edit, setEdit] = useState(false);
  const fields = [{ name: 'name', label: 'Company name', required: true }, { name: 'contact_person', label: 'Contact person' },
    { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address', type: 'textarea' }];
  if (!p) return 'Loading...';
  return html`<div><h1>My Profile</h1><div className="card">
    ${fields.map(f => html`<p key=${f.name}><b>${f.label}:</b> ${p[f.name] || '-'}</p>`)}
    <button onClick=${() => setEdit(true)}>Edit profile</button></div>
    ${edit && html`<${FormModal} title="Edit profile" fields=${fields} initial=${p} onSubmit=${v => PUT('/supplier/me', v)} onClose=${ok => { setEdit(false); ok && load(); }} />`}</div>`;
};

/* ---------------- Supplier: offers ---------------- */
Pages.Offers = () => {
  const [rows, load] = useData('/offers');
  const [meds] = useData('/medicines');
  const [form, setForm] = useState(null);
  const sup = Session.user.role === 'Supplier';
  const fields = [{ name: 'medicine_id', label: 'Medicine', type: 'select', options: opts(meds), required: true },
    { name: 'price', label: 'Price per unit', type: 'number', required: true }, { name: 'note', label: 'Note / terms', type: 'textarea' }];
  return html`<div><h1>${sup ? 'My Offers' : 'Supplier Offers'}</h1>
    ${sup && html`<div className="bar"><button onClick=${() => setForm({})}>+ New offer</button></div>`}
    <${Table} rows=${rows} cols=${[...(sup ? [] : [{ h: 'Supplier', f: r => r.supplier_name }]), { h: 'Medicine', f: r => r.medicine_name }, { h: 'Price', f: r => r.price.toFixed(2) },
      { h: 'Note', f: r => r.note }, { h: 'Status', f: r => activeBadge(r.active) },
      ...(sup ? [{ h: '', f: r => html`<button className="sm sec" onClick=${() => setForm(r)}>Edit</button>
        <button className="sm sec" onClick=${() => act(() => PUT('/offers/' + r.id, { active: !r.active }), 'Offer updated', load)}>${r.active ? 'Withdraw' : 'Re-activate'}</button>` }] : [])]} />
    ${form && html`<${FormModal} title=${form.id ? 'Edit offer' : 'New offer'} fields=${form.id ? fields.slice(1) : fields} initial=${form}
      onSubmit=${v => form.id ? PUT('/offers/' + form.id, v) : POST('/offers', v)} onClose=${ok => { setForm(null); ok && load(); }} />`}</div>`;
};

/* ---------------- Categories (Admin) ---------------- */
Pages.Categories = () => {
  const [rows, load] = useData('/categories');
  const [form, setForm] = useState(null);
  const admin = Session.user.role === 'Admin';
  const fields = [{ name: 'name', label: 'Category name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }];
  return html`<div><h1>Medicine Categories</h1>
    ${admin && html`<div className="bar"><button onClick=${() => setForm({})}>+ New category</button></div>`}
    <${Table} rows=${rows} cols=${[{ h: 'Name', f: r => r.name }, { h: 'Description', f: r => r.description }, { h: 'Status', f: r => activeBadge(r.active) },
      ...(admin ? [{ h: '', f: r => html`<button className="sm sec" onClick=${() => setForm(r)}>Edit</button>
        <button className=${'sm ' + (r.active ? 'red' : 'blue')} onClick=${() => act(() => PUT('/categories/' + r.id, { active: !r.active }), 'Category updated', load)}>${r.active ? 'Deactivate' : 'Activate'}</button>` }] : [])]} />
    ${form && html`<${FormModal} title=${form.id ? 'Edit category' : 'New category'} fields=${fields} initial=${form}
      onSubmit=${v => form.id ? PUT('/categories/' + form.id, v) : POST('/categories', v)} onClose=${ok => { setForm(null); ok && load(); }} />`}</div>`;
};

/* ---------------- Medicines: search, stock, batches ---------------- */
Pages.Medicines = () => {
  const [q, setQ] = useState(''), [cat, setCat] = useState(''), [lowOnly, setLowOnly] = useState(false);
  const [cats] = useData('/categories');
  const [rows, load] = useData(`/medicines?q=${encodeURIComponent(q)}&category_id=${cat}`);
  const [form, setForm] = useState(null), [view, setView] = useState(null);
  const mgr = Session.user.role === 'Warehouse Manager';
  const fields = [{ name: 'name', label: 'Medicine name', required: true },
    { name: 'category_id', label: 'Category', type: 'select', options: opts((cats || []).filter(c => c.active)), required: true },
    { name: 'unit', label: 'Unit (strips, bottles...)' }, { name: 'low_stock_limit', label: 'Low-stock limit', type: 'number', hint: 'Leave blank to use the system default' },
    { name: 'description', label: 'Description', type: 'textarea' }];
  const shown = rows && rows.filter(r => !lowOnly || r.low_stock);
  return html`<div><h1>${mgr ? 'Medicines & Stock' : 'Search Medicines & Stock'}</h1>
    <div className="bar"><input placeholder="Search by name or category..." value=${q} onChange=${e => setQ(e.target.value)} />
      <select value=${cat} onChange=${e => setCat(e.target.value)}><option value="">All categories</option>${(cats || []).map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}</select>
      <label style=${{ margin: 0 }}><input type="checkbox" style=${{ width: 'auto' }} checked=${lowOnly} onChange=${e => setLowOnly(e.target.checked)} /> Low stock only</label>
      ${mgr && html`<button onClick=${() => setForm({})}>+ New medicine</button>`}</div>
    <${Table} rows=${shown} cols=${[{ h: 'Medicine', f: r => r.name }, { h: 'Category', f: r => r.category_name },
      { h: 'Stock', f: r => html`<b>${r.stock}</b> ${r.unit}` }, { h: 'Limit', f: r => r.effective_limit },
      { h: 'Stock status', f: r => r.low_stock ? html`<${Badge} t="Low" />` : html`<${Badge} t="OK" />` }, { h: 'Active', f: r => activeBadge(r.active) },
      { h: '', f: r => html`<button className="sm blue" onClick=${() => setView(r)}>Batches</button>
        ${mgr && html`<button className="sm sec" onClick=${() => setForm(r)}>Edit</button>
        <button className=${'sm ' + (r.active ? 'red' : 'blue')} onClick=${() => act(() => PUT('/medicines/' + r.id, { active: !r.active }), 'Medicine updated', load)}>${r.active ? 'Deactivate' : 'Activate'}</button>`}` }]} />
    ${form && html`<${FormModal} title=${form.id ? 'Edit medicine' : 'New medicine'} fields=${fields} initial=${form}
      onSubmit=${v => form.id ? PUT('/medicines/' + form.id, v) : POST('/medicines', v)} onClose=${ok => { setForm(null); ok && load(); }} />`}
    ${view && html`<${BatchView} med=${view} onClose=${() => setView(null)} />`}</div>`;
};
function BatchView({ med, onClose }) {
  const [b] = useData('/batches?medicine_id=' + med.id);
  return html`<${Modal} title=${'Batches - ' + med.name} onClose=${onClose}>
    <${Table} rows=${b} empty="No batches received yet" cols=${[{ h: 'Batch', f: r => r.batch_no }, { h: 'Qty', f: r => r.quantity }, { h: 'Mfg', f: r => r.mfg_date },
      { h: 'Expiry', f: r => r.expiry_date }, { h: 'Status', f: r => html`<${Badge} t=${r.expiry_status} />` }]} />
    <p><button className="sec" onClick=${onClose}>Close</button></p></${Modal}>`;
}

/* ---------------- All batches / expiry overview ---------------- */
Pages.Batches = () => {
  const [rows] = useData('/batches');
  return html`<div><h1>Batches & Expiry</h1><${Table} rows=${rows} cols=${[{ h: 'Medicine', f: r => r.medicine_name }, { h: 'Batch', f: r => r.batch_no },
    { h: 'Qty left', f: r => r.quantity }, { h: 'Mfg date', f: r => r.mfg_date }, { h: 'Expiry date', f: r => r.expiry_date },
    { h: 'Days left', f: r => r.days_to_expiry }, { h: 'Status', f: r => html`<${Badge} t=${r.expiry_status} />` }]} /></div>`;
};

/* ---------------- Receiving (Worker) ---------------- */
Pages.Receiving = () => {
  const [meds] = useData('/medicines');
  const [recv, loadRecv] = useData('/purchases/receivable');
  const [batches, loadB] = useData('/batches');
  const [form, setForm] = useState(null);
  const fields = [{ name: 'medicine_id', label: 'Medicine', type: 'select', options: opts((meds || []).filter(m => m.active)), required: true },
    { name: 'batch_no', label: 'Batch number', required: true }, { name: 'quantity', label: 'Quantity received', type: 'number', required: true },
    { name: 'mfg_date', label: 'Manufacturing date', type: 'date', required: true }, { name: 'expiry_date', label: 'Expiry date', type: 'date', required: true }];
  const save = v => POST('/batches', { ...v, purchase_id: form.purchase_id });
  return html`<div><h1>Receive Medicines</h1>
    <div className="bar"><button onClick=${() => setForm({ purchase_id: null })}>+ Record batch (no purchase)</button></div>
    <h2>Purchases awaiting delivery (supplier accepted)</h2>
    <${Table} rows=${recv} empty="No accepted purchase orders waiting" cols=${[{ h: 'PO', f: r => r.po_number }, { h: 'Medicine', f: r => r.medicine_name }, { h: 'Supplier', f: r => r.supplier_name },
      { h: 'Ordered', f: r => r.quantity }, { h: 'Received', f: r => r.received_quantity }, { h: 'Status', f: r => html`<${Badge} t=${r.status} />` },
      { h: '', f: r => html`<button className="sm" onClick=${() => setForm({ purchase_id: r.id, medicine_id: r.medicine_id, quantity: r.quantity - r.received_quantity })}>Receive</button>` }]} />
    <h2>Recent batches</h2>
    <${Table} rows=${batches && batches.slice().sort((a, b) => b.id - a.id).slice(0, 10)} cols=${[{ h: 'Medicine', f: r => r.medicine_name }, { h: 'Batch', f: r => r.batch_no },
      { h: 'Received', f: r => r.received_quantity }, { h: 'Mfg', f: r => r.mfg_date }, { h: 'Expiry', f: r => r.expiry_date }, { h: 'By', f: r => r.received_by_name }]} />
    ${form && html`<${FormModal} title=${form.purchase_id ? 'Receive purchase #' + form.purchase_id : 'Record received batch'} fields=${form.purchase_id ? fields.filter(f => f.name !== 'medicine_id') : fields}
      initial=${form} submitLabel="Receive" onSubmit=${v => save({ ...v, medicine_id: form.medicine_id || v.medicine_id })}
      onClose=${ok => { setForm(null); if (ok) { toast('Batch received and stock updated'); loadRecv(); loadB(); } }} />`}</div>`;
};

/* ---------------- Purchases (Manager) ---------------- */
Pages.Purchases = () => {
  const [rows, load] = useData('/purchases');
  const [meds] = useData('/medicines');
  const [sups] = useData('/suppliers');
  const [offers] = useData('/offers');
  const [form, setForm] = useState(null), [po, setPo] = useState(null);
  const low = (meds || []).filter(m => m.low_stock);
  const fields = [{ name: 'medicine_id', label: 'Medicine', type: 'select', options: opts((meds || []).filter(m => m.active), m => `${m.name} (stock ${m.stock})`), required: true },
    { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'supplier_id', label: 'Preferred supplier (optional)', type: 'select', options: opts((sups || []).filter(s => s.active)) },
    { name: 'notes', label: 'Notes', type: 'textarea' }];
  const poFields = [{ name: 'supplier_id', label: 'Send purchase order to supplier', type: 'select', options: opts((sups || []).filter(s => s.active), s => {
    const o = (offers || []).find(o => o.supplier_id === s.id && po && o.medicine_id === po.medicine_id && o.active); return s.name + (o ? ` - offer ${o.price.toFixed(2)}/unit` : ''); }), required: true }];
  const editable = r => r.status === 'Draft' || (r.status === 'Ordered' && r.po_status !== 'Accepted');
  return html`<div><h1>Purchases</h1>
    ${low.length > 0 && html`<div className="card"><b>Low-stock medicines:</b> ${low.map(m => html`<span key=${m.id} style=${{ marginRight: 8 }}>
      <button className="sm sec" onClick=${() => setForm({ medicine_id: m.id, quantity: Math.max(m.effective_limit * 2 - m.stock, 1) })}>${m.name} (${m.stock}/${m.effective_limit}) + purchase</button></span>`)}</div>`}
    <div className="bar"><button onClick=${() => setForm({})}>+ New purchase</button></div>
    <${Table} rows=${rows} cols=${[{ h: '#', f: r => r.id }, { h: 'Medicine', f: r => r.medicine_name }, { h: 'Qty', f: r => r.quantity }, { h: 'Supplier', f: r => r.supplier_name || '-' },
      { h: 'Status', f: r => html`<${Badge} t=${r.status} />` }, { h: 'Order', f: r => r.po_number ? html`${r.po_number} <${Badge} t=${r.po_status} />` : '-' },
      { h: 'Received', f: r => r.received_quantity },
      { h: 'Actions', f: r => html`${editable(r) && html`<button className="sm sec" onClick=${() => setForm(r)}>Edit</button>`}
        ${(r.status === 'Draft' || (r.status === 'Ordered' && ['Rejected', 'Change Proposed'].includes(r.po_status))) && html`<button className="sm blue" onClick=${() => setPo(r)}>${r.status === 'Draft' ? 'Generate & send PO' : 'Resend PO'}</button>`}
        ${['Draft', 'Ordered'].includes(r.status) && html`<button className="sm red" onClick=${() => confirm('Cancel this purchase?') && act(() => POST(`/purchases/${r.id}/cancel`), 'Purchase cancelled', load)}>Cancel</button>`}` }]} />
    ${form && html`<${FormModal} title=${form.id ? 'Edit purchase #' + form.id : 'New purchase'} fields=${fields} initial=${form}
      onSubmit=${v => form.id ? PUT('/purchases/' + form.id, v) : POST('/purchases', v)} onClose=${ok => { setForm(null); ok && load(); }} />`}
    ${po && html`<${FormModal} title=${`Purchase order for ${po.medicine_name} x ${po.quantity}`} fields=${poFields} initial=${{ supplier_id: po.supplier_id || '' }} submitLabel="Send purchase order"
      onSubmit=${v => POST(`/purchases/${po.id}/send-po`, v)} onClose=${ok => { setPo(null); if (ok) { toast('Purchase order sent'); load(); } }} />`}</div>`;
};

/* ---------------- Purchase orders (Supplier responds, Manager resolves) ---------------- */
Pages.Orders = () => {
  const [rows, load] = useData('/orders');
  const [prop, setProp] = useState(null);
  const role = Session.user.role;
  return html`<div><h1>${role === 'Supplier' ? 'Purchase Orders for Me' : 'Purchase Orders'}</h1>
    <${Table} rows=${rows} cols=${[{ h: 'PO number', f: r => r.po_number }, ...(role !== 'Supplier' ? [{ h: 'Supplier', f: r => r.supplier_name }] : []), { h: 'Medicine', f: r => r.medicine_name },
      { h: 'Qty', f: r => r.quantity }, { h: 'Offer price', f: r => r.offer_price ? r.offer_price.toFixed(2) : '-' }, { h: 'Sent', f: r => (r.sent_at || '').slice(0, 10) },
      { h: 'Status', f: r => html`<${Badge} t=${r.status} />` },
      { h: 'Response', f: r => r.status === 'Change Proposed' ? html`Proposed qty <b>${r.proposed_quantity}</b>: ${r.supplier_note}` : (r.supplier_note || '') },
      { h: 'Actions', f: r => role === 'Supplier' && r.status === 'Sent' ? html`
          <button className="sm" onClick=${() => act(() => POST(`/orders/${r.id}/respond`, { action: 'accept' }), 'Order accepted', load)}>Accept</button>
          <button className="sm red" onClick=${() => confirm('Reject this order?') && act(() => POST(`/orders/${r.id}/respond`, { action: 'reject' }), 'Order rejected', load)}>Reject</button>
          <button className="sm blue" onClick=${() => setProp(r)}>Propose change</button>`
        : role === 'Warehouse Manager' && r.status === 'Change Proposed' ? html`
          <button className="sm" onClick=${() => act(() => POST(`/orders/${r.id}/resolve`, { accept: true }), 'Proposal accepted, purchase updated', load)}>Accept proposal</button>
          <button className="sm red" onClick=${() => act(() => POST(`/orders/${r.id}/resolve`, { accept: false }), 'Proposal rejected', load)}>Reject</button>` : '' }]} />
    ${prop && html`<${FormModal} title=${'Propose change - ' + prop.po_number} initial=${{}} submitLabel="Send proposal"
      fields=${[{ name: 'quantity', label: 'Quantity you can supply', type: 'number', required: true }, { name: 'note', label: 'Reason / details', type: 'textarea', required: true }]}
      onSubmit=${v => POST(`/orders/${prop.id}/respond`, { action: 'propose', ...v })} onClose=${ok => { setProp(null); if (ok) { toast('Proposal sent'); load(); } }} />`}</div>`;
};

/* ---------------- Damaged / returned (Worker reports, Manager reviews) ---------------- */
Pages.Returns = () => {
  const [rows, load] = useData('/returns');
  const [batches] = useData('/batches');
  const [form, setForm] = useState(null);
  const role = Session.user.role;
  const fields = [{ name: 'batch_id', label: 'Batch', type: 'select', required: true, options: opts((batches || []).filter(b => b.quantity > 0), b => `${b.medicine_name} - ${b.batch_no} (qty ${b.quantity})`) },
    { name: 'type', label: 'Type', type: 'select', required: true, options: [{ v: 'Damaged', l: 'Damaged' }, { v: 'Returned', l: 'Returned' }] },
    { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }];
  return html`<div><h1>Damaged / Returned Medicines</h1>
    ${role === 'Warehouse Worker' && html`<div className="bar"><button onClick=${() => setForm({})}>+ Report damaged / returned</button></div>`}
    <${Table} rows=${rows} cols=${[{ h: '#', f: r => r.id }, { h: 'Medicine', f: r => r.medicine_name }, { h: 'Batch', f: r => r.batch_no }, { h: 'Type', f: r => r.type },
      { h: 'Qty', f: r => r.quantity }, { h: 'Reason', f: r => r.reason }, { h: 'Reported by', f: r => r.reported_by_name }, { h: 'Status', f: r => html`<${Badge} t=${r.status} />` },
      { h: 'Reviewed by', f: r => r.reviewed_by_name || '-' },
      { h: '', f: r => role === 'Warehouse Manager' && r.status === 'Pending' ? html`
        <button className="sm" onClick=${() => act(() => POST(`/returns/${r.id}/review`, { decision: 'approve' }), 'Approved - stock reduced', load)}>Approve</button>
        <button className="sm red" onClick=${() => act(() => POST(`/returns/${r.id}/review`, { decision: 'reject' }), 'Report rejected - stock unchanged', load)}>Reject</button>` : '' }]} />
    ${form && html`<${FormModal} title="Report damaged / returned medicine" fields=${fields} initial=${form} submitLabel="Submit report"
      onSubmit=${v => POST('/returns', v)} onClose=${ok => { setForm(null); if (ok) { toast('Report submitted for approval'); load(); } }} />`}</div>`;
};

/* ---------------- Stock audits ---------------- */
Pages.Audits = () => {
  const [rows, load] = useData('/audits');
  const [open, setOpen] = useState(null);
  const role = Session.user.role;
  if (open) return html`<${AuditDetail} id=${open} onBack=${() => { setOpen(null); load(); }} />`;
  return html`<div><h1>Stock Audits</h1>
    ${role === 'Warehouse Manager' && html`<div className="bar"><button onClick=${() => act(() => POST('/audits'), 'Audit started - worker can now enter counts', load)}>+ Start new stock audit</button></div>`}
    <${Table} rows=${rows} cols=${[{ h: 'Audit', f: r => '#' + r.id }, { h: 'Started', f: r => (r.created_at || '').slice(0, 16) }, { h: 'Started by', f: r => r.started_by_name },
      { h: 'Counted', f: r => `${r.counted}/${r.item_count}` }, { h: 'Status', f: r => html`<${Badge} t=${r.status} />` },
      { h: '', f: r => html`<button className="sm blue" onClick=${() => setOpen(r.id)}>Open</button>` }]} /></div>`;
};
function AuditDetail({ id, onBack }) {
  const [a, load] = useData('/audits/' + id);
  const [counts, setCounts] = useState({});
  const role = Session.user.role;
  if (!a) return 'Loading...';
  const canCount = role === 'Warehouse Worker' && a.status === 'Open';
  const payload = () => Object.entries(counts).filter(([, v]) => v !== '').map(([id, v]) => ({ id: Number(id), physical_qty: v }));
  const saveCounts = async () => { if (payload().length) await POST(`/audits/${id}/count`, { items: payload() }); setCounts({}); await load(); };
  return html`<div><button className="sec" onClick=${onBack}>&larr; Back</button><h1 style=${{ marginTop: 10 }}>Stock Audit #${a.id} <${Badge} t=${a.status} /></h1>
    <${Table} rows=${a.items} cols=${[{ h: 'Medicine', f: r => r.medicine_name }, { h: 'Recorded', f: r => r.recorded_qty },
      { h: 'Physical count', f: r => canCount ? html`<input type="number" min="0" style=${{ width: 100 }} placeholder=${r.physical_qty ?? ''} value=${counts[r.id] ?? ''} onChange=${e => setCounts({ ...counts, [r.id]: e.target.value })} />` : (r.physical_qty ?? '-') },
      { h: 'Difference', f: r => r.difference === null ? '-' : html`<b style=${{ color: r.difference < 0 ? '#dc2626' : r.difference > 0 ? '#16a34a' : 'inherit' }}>${r.difference > 0 ? '+' : ''}${r.difference}</b>` },
      { h: 'Adjustment', f: r => r.physical_qty === null ? '-' : html`<${Badge} t=${r.adjustment_status} />` },
      { h: '', f: r => role === 'Warehouse Manager' && a.status === 'Counted' && r.adjustment_status === 'Pending' ? html`
        <button className="sm" onClick=${() => act(() => POST(`/audits/${id}/items/${r.id}/decision`, { decision: 'approve' }), 'Adjustment approved - stock updated', load)}>Approve</button>
        <button className="sm red" onClick=${() => act(() => POST(`/audits/${id}/items/${r.id}/decision`, { decision: 'reject' }), 'Adjustment rejected - stock unchanged', load)}>Reject</button>` : '' }]} />
    ${canCount && html`<p><button onClick=${() => act(saveCounts, 'Counts saved')}>Save counts</button>
      <button className="blue" onClick=${() => act(async () => { await saveCounts(); await POST(`/audits/${id}/submit`); }, 'Counts submitted to manager', load)}>Submit all counts</button></p>`}</div>`;
}

/* ---------------- Settings & audit log (Admin) ---------------- */
Pages.Settings = () => {
  const [s, load] = useData('/settings');
  const [edit, setEdit] = useState(false);
  if (!s) return 'Loading...';
  const fields = [{ name: 'warehouse_name', label: 'Warehouse name', required: true }, { name: 'default_low_stock_limit', label: 'Default low-stock limit', type: 'number', required: true },
    { name: 'expiry_alert_days', label: 'Expiry alert (days before expiry)', type: 'number', required: true }];
  return html`<div><h1>System Settings</h1><div className="card">
    ${fields.map(f => html`<p key=${f.name}><b>${f.label}:</b> ${s[f.name]}</p>`)}<button onClick=${() => setEdit(true)}>Edit settings</button></div>
    ${edit && html`<${FormModal} title="Edit settings" fields=${fields} initial=${s} onSubmit=${v => PUT('/settings', v)} onClose=${ok => { setEdit(false); if (ok) { toast('Settings saved'); load(); } }} />`}</div>`;
};
Pages.Log = () => {
  const [rows] = useData('/audit-log');
  return html`<div><h1>System Action Log</h1><${Table} rows=${rows} cols=${[{ h: 'Time', f: r => r.created_at }, { h: 'User', f: r => r.user_name },
    { h: 'Action', f: r => r.action }, { h: 'Details', f: r => r.details }]} /></div>`;
};
