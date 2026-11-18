require('dotenv').config(); // loads backend/.env (DB credentials etc.) if the file exists
const express = require('express');
const { init } = require('./db');

const app = express();
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

// CORS: allow the separately hosted frontend to call this API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.get('/', (req, res) => res.json({ service: 'PWMS backend API', status: 'running', api: '/api' }));
app.use('/api', require('./routes/master'));
app.use('/api', require('./routes/inventory'));
app.use('/api', require('./routes/purchasing'));
app.use('/api', require('./routes/control'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error: ' + err.message }); });

const PORT = process.env.PORT || 5000;
init().then(() => {
  app.listen(PORT, () => console.log(`PWMS backend API running at http://localhost:${PORT}  (accepting frontend at ${FRONTEND_ORIGIN})`));
}).catch(e => { console.error('Could not start: database connection failed ->', e.message); process.exit(1); });
