// Static server for the React frontend. All data comes from the separate backend API (see public/config.js).
const express = require('express');
const path = require('path');

const app = express();
const nm = p => path.join(__dirname, 'node_modules', p);
app.get('/vendor/react.js', (q, r) => r.sendFile(nm('react/umd/react.development.js')));
app.get('/vendor/react-dom.js', (q, r) => r.sendFile(nm('react-dom/umd/react-dom.development.js')));
app.get('/vendor/htm.js', (q, r) => r.sendFile(nm('htm/dist/htm.js')));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PWMS frontend running at http://localhost:${PORT}  (API: see public/config.js)`));
