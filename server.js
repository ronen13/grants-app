const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ── DB SETUP ──
const db = new Database(process.env.DB_PATH || './grants.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT,
    sector TEXT,
    email TEXT,
    phone TEXT,
    message TEXT,
    presenter TEXT DEFAULT 'מענקים בקליק',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS grants (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    name TEXT,
    org TEXT,
    cat TEXT,
    amount TEXT,
    cover TEXT,
    deadline TEXT,
    status TEXT DEFAULT 'open',
    match_pct INTEGER DEFAULT 70,
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );
`);

// ── MIDDLEWARE ──
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple admin password protection
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'grants2024';

function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-key'];
  if (auth !== ADMIN_PASS) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── API: CLIENTS ──

// GET all clients
app.get('/api/clients', requireAdmin, (req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  const result = clients.map(c => ({
    ...c,
    grants: db.prepare('SELECT * FROM grants WHERE client_id = ? ORDER BY sort_order, rowid').all(c.id)
  }));
  res.json(result);
});

// GET single client (public – for client view)
app.get('/api/client/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const grants = db.prepare('SELECT * FROM grants WHERE client_id = ? ORDER BY sort_order, rowid').all(client.id);
  // Remove internal notes from public view
  const publicGrants = grants.map(({ notes, ...g }) => g);
  res.json({ ...client, grants: publicGrants });
});

// POST create client
app.post('/api/clients', requireAdmin, (req, res) => {
  const id = crypto.randomBytes(8).toString('hex');
  const { name, contact, sector, email, phone, message, presenter } = req.body;
  db.prepare(`
    INSERT INTO clients (id, name, contact, sector, email, phone, message, presenter)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, contact||'', sector||'', email||'', phone||'', message||'', presenter||'מענקים בקליק');
  res.json({ id, name });
});

// PUT update client
app.put('/api/clients/:id', requireAdmin, (req, res) => {
  const { name, contact, sector, email, phone, message, presenter } = req.body;
  db.prepare(`
    UPDATE clients SET name=?, contact=?, sector=?, email=?, phone=?, message=?, presenter=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, contact||'', sector||'', email||'', phone||'', message||'', presenter||'מענקים בקליק', req.params.id);
  res.json({ ok: true });
});

// DELETE client
app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── API: GRANTS ──

// POST add grant to client
app.post('/api/clients/:clientId/grants', requireAdmin, (req, res) => {
  const id = crypto.randomBytes(8).toString('hex');
  const { name, org, cat, amount, cover, deadline, status, match_pct, notes } = req.body;
  db.prepare(`
    INSERT INTO grants (id, client_id, name, org, cat, amount, cover, deadline, status, match_pct, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.clientId, name||'', org||'', cat||'', amount||'', cover||'', deadline||'', status||'open', match_pct||70, notes||'');
  res.json({ id });
});

// PUT update grant
app.put('/api/grants/:id', requireAdmin, (req, res) => {
  const { name, org, cat, amount, cover, deadline, status, match_pct, notes } = req.body;
  db.prepare(`
    UPDATE grants SET name=?, org=?, cat=?, amount=?, cover=?, deadline=?, status=?, match_pct=?, notes=?
    WHERE id=?
  `).run(name||'', org||'', cat||'', amount||'', cover||'', deadline||'', status||'open', match_pct||70, notes||'', req.params.id);
  res.json({ ok: true });
});

// DELETE grant
app.delete('/api/grants/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM grants WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PUT bulk replace grants for a client
app.put('/api/clients/:clientId/grants', requireAdmin, (req, res) => {
  const { grants } = req.body;
  db.prepare('DELETE FROM grants WHERE client_id = ?').run(req.params.clientId);
  const insert = db.prepare(`
    INSERT INTO grants (id, client_id, name, org, cat, amount, cover, deadline, status, match_pct, notes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  grants.forEach((g, i) => {
    const id = crypto.randomBytes(8).toString('hex');
    insert.run(id, req.params.clientId, g.name||'', g.org||'', g.cat||'', g.amount||'', g.cover||'', g.deadline||'', g.status||'open', g.match_pct||70, g.notes||'', i);
  });
  res.json({ ok: true });
});

// ── CLIENT PAGE ──
app.get('/client/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// ── FALLBACK → serve index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ Grants server running on port ${PORT}`));
