// Login, role-based menu, app shell
const MENUS = {
  'Admin': [['Dashboard', 'Dashboard'], ['Users', 'Users'], ['Suppliers', 'Suppliers'], ['Categories', 'Medicine Categories'], ['Medicines', 'Medicines & Stock'],
    ['Settings', 'System Settings'], ['Log', 'System Action Log']],
  'Warehouse Manager': [['Dashboard', 'Dashboard'], ['Medicines', 'Medicines & Stock'], ['Batches', 'Batches & Expiry'], ['Purchases', 'Purchases'], ['Orders', 'Purchase Orders'],
    ['Suppliers', 'Suppliers'], ['Returns', 'Damaged / Returns'], ['Audits', 'Stock Audits']],
  'Warehouse Worker': [['Dashboard', 'Dashboard'], ['Medicines', 'Search Medicines'], ['Batches', 'Batches & Expiry'], ['Receiving', 'Receive Medicines'], ['Returns', 'Damaged / Returns'], ['Audits', 'Stock Audits']],
  'Supplier': [['Dashboard', 'Dashboard'], ['Profile', 'My Profile'], ['Offers', 'My Offers'], ['Orders', 'Purchase Orders']]
};

function Login({ onLogin }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault(); setErr('');
    if (!email || !password) return setErr('Please enter email and password');
    try { const r = await POST('/auth/login', { email, password }); Session.set(r.token, r.user); onLogin(r.user); } catch (x) { setErr(x.message); }
  };
  const demo = [['Admin', 'admin@pwms.com', 'admin123'], ['Warehouse Manager', 'manager@pwms.com', 'manager123'], ['Warehouse Worker', 'worker@pwms.com', 'worker123'], ['Supplier', 'supplier@pwms.com', 'supplier123']];
  return html`<div className="login-wrap"><form className="login" onSubmit=${go}>
    <h1>PWMS</h1><div className="muted">Pharmaceutical Warehouse Management System</div>
    <label>Email</label><input type="email" value=${email} onChange=${e => setEmail(e.target.value)} />
    <label>Password</label><input type="password" value=${password} onChange=${e => setPassword(e.target.value)} />
    ${err && html`<div className="err">${err}</div>`}
    <p><button style=${{ width: '100%', padding: 10 }}>Log in</button></p>
    <div className="demo"><b>Demo accounts (click to fill):</b>${demo.map(([r, e, p]) => html`<a key=${e} onClick=${() => { setEmail(e); setPassword(p); }}>${r}: ${e} / ${p}</a>`)}</div>
  </form></div>`;
}

function App() {
  const [user, setUser] = useState(Session.user && Session.token ? Session.user : null);
  const [page, setPage] = useState('Dashboard');
  const [name, setName] = useState('');
  useEffect(() => { if (user) GET('/settings').then(s => setName(s.warehouse_name)).catch(() => {}); }, [user, page]);
  if (!user) return html`<${Login} onLogin=${u => { setUser(u); setPage('Dashboard'); }} />`;
  const menu = MENUS[user.role], Page = Pages[page];
  return html`<div className="app">
    <div className="side"><div className="brand">PWMS<small>${name}</small></div>
      <div style=${{ height: 8 }}></div>
      ${menu.map(([k, l]) => html`<a key=${k} className=${page === k ? 'on' : ''} onClick=${() => setPage(k)}>${l}</a>`)}</div>
    <div className="main">
      <div className="top"><div>${user.name}<span className="role">${user.role}</span></div>
        <button className="sec" onClick=${() => { Session.clear(); setUser(null); }}>Log out</button></div>
      <div className="content"><${Page} key=${page} /></div></div></div>`;
}

ReactDOM.render(html`<${React.Fragment}><${App} /><${Toaster} /></${React.Fragment}>`, document.getElementById('root'));
