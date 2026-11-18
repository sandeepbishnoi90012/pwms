# PWMS - Pharmaceutical Warehouse Management System

Three-tier app built from the SRS: separate **frontend**, **backend** and **MySQL database**.

| Part | Folder | Tech | Local port |
|---|---|---|---|
| **Frontend** (web UI) | `frontend/` | React (static files) | 3000 |
| **Backend** (REST API) | `backend/` | Node.js + Express, JWT auth, bcrypt passwords | 5000 |
| **Database** | - | MySQL (local MySQL, or free **TiDB Cloud**) | 3306 / 4000 |

On the first backend start the tables are created and filled with sample data automatically. Data **persists** in MySQL.

---
## 1. Run locally

### Prerequisites
- Node.js v18 or newer (v22 recommended). If `npm` is "not recognized" or scripts are disabled, reopen the terminal; on Windows PowerShell run once: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` (or use `npm.cmd`).
- A MySQL database - **either**:
  - **A. Local MySQL** (XAMPP / MySQL Installer) running on port 3306, **or**
  - **B. TiDB Cloud free cluster** (see section 2, step 1) - no local install needed.

### Backend (Terminal 1)
```powershell
cd backend
copy .env.example .env      # then edit .env: put your DB details (see comments inside)
npm install
npm start                   # -> http://localhost:5000
```
You should see `Database ready (...)` then `PWMS backend API running at http://localhost:5000`.

### Frontend (Terminal 2)
```powershell
cd frontend
npm install
npm start                   # -> http://localhost:3000
```
Open **http://localhost:3000** and log in with a demo account (below).

### Check it works
1. http://localhost:5000 -> `{"service":"PWMS backend API","status":"running",...}`
2. http://localhost:3000 -> login page; sign in.
3. Automated API test (backend running; 51 checks covering FR-01..FR-23): `cd backend` then `npm test`.
   The test adds sample records. To get clean data, drop the database (`DROP DATABASE pwms;`) and restart the backend.

---
## 2. Deploy free on the internet (step by step)

Result: Frontend on Render (static site) -> Backend on Render (web service) -> Database on TiDB Cloud (MySQL). All free; no credit card needed for TiDB Starter / Render free tier (verify current terms on their sites).

### Step 0 - Put the code on GitHub
1. Create a GitHub account and a **new empty repository** (e.g. `pwms`).
2. In the project root:
   ```powershell
   git init
   git add .
   git commit -m "PWMS"
   git branch -M main
   git remote add origin https://github.com/<your-user>/pwms.git
   git push -u origin main
   ```
   (`.gitignore` already excludes `node_modules` and secrets.)

### Step 1 - Create the free MySQL database (TiDB Cloud)
1. Sign up at https://tidbcloud.com and create a **Starter (free)** cluster.
2. Open the cluster -> **Connect**. Choose "General" and **generate a password** (save it!).
3. Note: **Host**, **Port** (4000), **User** (looks like `xxxxxxx.root`) and the password.
4. You do not need to create tables - the backend creates them on first start. (If your user cannot create databases, the cluster's default database `test` can be used: set `DB_NAME=test`.)

### Step 2 - Deploy backend + frontend on Render
1. Sign up at https://render.com with GitHub.
2. **New +** -> **Blueprint** -> choose your `pwms` repo. Render reads `render.yaml` and proposes two services: `pwms-backend` and `pwms-frontend`.
3. Fill the prompted values:
   - `pwms-backend`: `DB_HOST`, `DB_USER`, `DB_PASSWORD` from TiDB (step 1). `DB_PORT=4000`, `DB_SSL=true` are preset. Leave `FRONTEND_ORIGIN` empty for now.
   - `pwms-frontend`: leave `PWMS_API` empty for now.
4. Click **Apply**. Wait until both are deployed. Note the two URLs, e.g.
   - backend: `https://pwms-backend.onrender.com`
   - frontend: `https://pwms-frontend.onrender.com`
5. **Connect them** (Render dashboard -> each service -> Environment):
   - `pwms-backend` -> `FRONTEND_ORIGIN` = `https://pwms-frontend.onrender.com` (exact URL, no trailing `/`)
   - `pwms-frontend` -> `PWMS_API` = `https://pwms-backend.onrender.com/api`
   Save. The backend restarts; for the frontend click **Manual Deploy -> Deploy latest commit** so the new API URL is built in.
6. Open the frontend URL and log in (`manager@pwms.com` / `manager123`).

Notes
- Free Render web services **sleep after ~15 min idle**; the first request after that takes ~30-60 s. Open the backend URL once before a demo to wake it.
- Data lives in TiDB, so it is **not lost** when Render restarts.
- Change the demo passwords (Admin -> Users) before sharing the link publicly.

### Alternative frontend hosts
`frontend/netlify.toml` is included. On Netlify/Cloudflare Pages/Vercel: build command `npm install && npm run build`, publish directory `frontend/public` (base `frontend`), environment variable `PWMS_API=https://<backend>/api`. Then set the backend's `FRONTEND_ORIGIN` to that site's URL.

### Troubleshooting
| Symptom | Fix |
|---|---|
| Login says "Failed to fetch" | `PWMS_API` wrong, or backend asleep, or `FRONTEND_ORIGIN` does not exactly match the frontend URL (CORS). Redeploy the frontend after changing `PWMS_API`. |
| Backend log: `database connection failed` | Check `DB_HOST/DB_USER/DB_PASSWORD`, `DB_PORT=4000`, `DB_SSL=true`. |
| Backend log: `Access denied` | TiDB user must include the prefix, e.g. `abc123.root`. |

---
## Configuration reference
Backend (`backend/.env` locally, Environment tab on Render): `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` (or one `DATABASE_URL=mysql://user:pass@host:port/db`), `PORT` (5000), `FRONTEND_ORIGIN` (`http://localhost:3000`), `JWT_SECRET`.
Frontend: `PORT` (3000) for `npm start`; the API address is `frontend/public/config.js` (generated from `PWMS_API` by `npm run build`).

## Demo accounts
| Role | Email | Password |
|---|---|---|
| Admin | admin@pwms.com | admin123 |
| Warehouse Manager | manager@pwms.com | manager123 |
| Warehouse Worker | worker@pwms.com | worker123 |
| Supplier (MediSupply) | supplier@pwms.com | supplier123 |
| Supplier (HealWell) | supplier2@pwms.com | supplier123 |

## Demo flow
1. **Manager**: Dashboard shows low-stock medicines -> Purchases -> "+ purchase" -> Generate & send PO to a supplier.
2. **Supplier**: Purchase Orders -> Accept / Reject / Propose change. Manager resolves proposals.
3. **Worker**: Receive Medicines against the accepted PO (expiry earlier than manufacturing date is rejected). Stock and purchase status update.
4. **Worker**: Damaged / Returns -> report; **Manager** approves/rejects (stock changes only after approval; worker cannot approve).
5. **Manager** starts a Stock Audit; **Worker** enters counts; differences are calculated; **Manager** approves/rejects each adjustment.
6. **Admin**: Users, Suppliers, Categories, System Settings, System Action Log.

## Structure
```
PWMS/
  render.yaml         Render blueprint (backend + frontend)
  .gitignore
  backend/
    index.js          Express API entry (CORS, routes, DB init)
    db.js             MySQL schema (mysql2), sample data, transactions
    auth.js           JWT + role check
    routes/           master, inventory, purchasing, control
    smoke-test.js     API test (FR-01..FR-23)
    .env.example      DB settings template
  frontend/
    server.js         local static server (npm start)
    build.js          static build for hosting (npm run build)
    netlify.toml      optional Netlify settings
    public/           index.html, config.js, app.js, pages.js, main.js, style.css
```
