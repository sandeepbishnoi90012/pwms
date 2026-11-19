// Shared helpers + UI building blocks
const { useState, useEffect, useCallback } = React;
const html = htm.bind(React.createElement);

const Session = {
  get token() { return localStorage.getItem('pwms_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('pwms_user')); } catch { return null; } },
  set(token, user) { localStorage.setItem('pwms_token', token); localStorage.setItem('pwms_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('pwms_token'); localStorage.removeItem('pwms_user'); }
};

async function api(method, url, body) {
  const res = await fetch((window.PWMS_API || '/api') + url, {
    method, headers: { 'Content-Type': 'application/json', ...(Session.token ? { Authorization: 'Bearer ' + Session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && Session.token) { Session.clear(); location.reload(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const GET = u => api('GET', u), POST = (u, b) => api('POST', u, b || {}), PUT = (u, b) => api('PUT', u, b);

// toast notifications
let toastFn = () => {};
const toast = (msg, bad) => toastFn(msg, bad);
function Toaster() {
  const [t, setT] = useState(null);
  toastFn = (msg, bad) => { setT({ msg, bad }); setTimeout(() => setT(null), 3500); };
  return t ? html`<div className=${'toast' + (t.bad ? ' bad' : '')}>${t.msg}</div>` : null;
}

// load data from API and reload on demand
function useData(url) {
  const [data, setData] = useState(null);
  const load = useCallback(() => GET(url).then(setData).catch(e => toast(e.message, true)), [url]);
  useEffect(() => { setData(null); load(); }, [load]);
  return [data, load];
}

const colors = { Active: 'g', Approved: 'g', Accepted: 'g', Completed: 'g', OK: 'g', Inactive: 'x', Cancelled: 'x', Rejected: 'r', Expired: 'r', Low: 'r', Pending: 'y', Draft: 'x',
  Sent: 'b', Ordered: 'b', 'Partially Received': 'y', 'Change Proposed': 'y', 'Expiring soon': 'y', Open: 'b', Counted: 'y', 'No change': 'x', Superseded: 'x' };
const Badge = ({ t }) => html`<span className=${'badge ' + (colors[t] || 'x')}>${t}</span>`;
const activeBadge = v => html`<${Badge} t=${v ? 'Active' : 'Inactive'} />`;

function Table({ cols, rows, empty }) {
  if (!rows) return html`<p className="muted">Loading...</p>`;
  return html`<div className="tw"><table>
    <thead><tr>${cols.map(c => html`<th key=${c.h}>${c.h}</th>`)}</tr></thead>
    <tbody>${rows.length === 0 ? html`<tr><td colSpan=${cols.length} className="muted">${empty || 'No records found'}</td></tr>` :
      rows.map((r, i) => html`<tr key=${r.id ?? i}>${cols.map(c => html`<td key=${c.h}>${c.f(r)}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

function Modal({ title, onClose, children }) {
  return html`<div className="overlay" onClick=${onClose}><div className="modal" onClick=${e => e.stopPropagation()}>
    <h2 style=${{ marginTop: 0 }}>${title}</h2>${children}</div></div>`;
}

// Generic form inside a modal. fields: {name,label,type,options:[{v,l}],required,hint}
function FormModal({ title, fields, initial, onSubmit, onClose, submitLabel }) {
  const [v, setV] = useState(() => ({ ...Object.fromEntries(fields.map(f => [f.name, ''])), ...initial }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr('');
    for (const f of fields) if ((!f.showIf || f.showIf(v)) && f.required && String(v[f.name] ?? '').trim() === '') return setErr(`${f.label} is required`);
    setBusy(true);
    try { await onSubmit(v); onClose(true); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return html`<${Modal} title=${title} onClose=${() => onClose(false)}>
    <form onSubmit=${submit}>
      ${fields.filter(f => !f.showIf || f.showIf(v)).map(f => html`<div key=${f.name}>
        <label>${f.label}${f.required ? ' *' : ''}</label>
        ${f.type === 'select' ? html`<select value=${v[f.name] ?? ''} onChange=${e => setV({ ...v, [f.name]: e.target.value })}>
            <option value="">-- select --</option>${f.options.map(o => html`<option key=${o.v} value=${o.v}>${o.l}</option>`)}</select>`
        : f.type === 'textarea' ? html`<textarea rows="3" value=${v[f.name] ?? ''} onChange=${e => setV({ ...v, [f.name]: e.target.value })} />`
        : html`<input type=${f.type || 'text'} value=${v[f.name] ?? ''} onChange=${e => setV({ ...v, [f.name]: e.target.value })} />`}
        ${f.hint && html`<small className="muted">${f.hint}</small>`}</div>`)}
      ${err && html`<div className="err">${err}</div>`}
      <div style=${{ marginTop: 16 }}><button disabled=${busy}>${submitLabel || 'Save'}</button>
        <button type="button" className="sec" onClick=${() => onClose(false)}>Cancel</button></div>
    </form></${Modal}>`;
}

// run an action with toast feedback
async function act(fn, okMsg, reload) {
  try { await fn(); toast(okMsg); reload && reload(); } catch (e) { toast(e.message, true); }
}
const opts = (rows, l = 'name') => (rows || []).map(r => ({ v: r.id, l: typeof l === 'function' ? l(r) : r[l] }));
