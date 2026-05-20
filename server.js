const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');

function readData(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  } catch {
    return file.endsWith('.json') && file === 'portfolio.json' ? [] : {};
  }
}

function writeData(file, data) {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2));
}

// In-memory session tokens
const sessions = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const token = generateToken();
    sessions.add(token);
    res.json({ token, success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.headers.authorization?.replace('Bearer ', ''));
  res.json({ success: true });
});

app.get('/api/auth/check', requireAuth, (req, res) => {
  res.json({ authenticated: true });
});

// ── Content ───────────────────────────────────────────────────────────────────
app.get('/api/content', (req, res) => {
  res.json(readData('content.json'));
});

app.put('/api/content', requireAuth, (req, res) => {
  writeData('content.json', req.body);
  res.json({ success: true });
});

// ── Image Upload ──────────────────────────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.delete('/api/upload', requireAuth, (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('/uploads/')) return res.status(400).json({ error: 'Invalid url' });
  const file = path.join(__dirname, 'public', url);
  try { fs.unlinkSync(file); } catch {}
  res.json({ success: true });
});

// ── Portfolio ─────────────────────────────────────────────────────────────────
app.get('/api/portfolio', (req, res) => {
  res.json(readData('portfolio.json'));
});

app.post('/api/portfolio', requireAuth, (req, res) => {
  const items = readData('portfolio.json');
  const item = { ...req.body, id: Date.now().toString() };
  items.push(item);
  writeData('portfolio.json', items);
  res.json(item);
});

app.put('/api/portfolio/reorder', requireAuth, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const items = readData('portfolio.json');
  const reordered = order.map(id => items.find(p => p.id === id)).filter(Boolean);
  const rest = items.filter(p => !order.includes(p.id));
  writeData('portfolio.json', [...reordered, ...rest]);
  res.json({ success: true });
});

app.post('/api/portfolio/:id/duplicate', requireAuth, (req, res) => {
  const items = readData('portfolio.json');
  const src = items.find(p => p.id === req.params.id);
  if (!src) return res.status(404).json({ error: 'Not found' });
  const copy = { ...src, id: Date.now().toString(), title: src.title + ' (Copy)', featured: false };
  items.push(copy);
  writeData('portfolio.json', items);
  res.json(copy);
});

app.put('/api/portfolio/:id', requireAuth, (req, res) => {
  const items = readData('portfolio.json');
  const idx = items.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  items[idx] = { ...items[idx], ...req.body };
  writeData('portfolio.json', items);
  res.json(items[idx]);
});

app.delete('/api/portfolio/:id', requireAuth, (req, res) => {
  const items = readData('portfolio.json');
  writeData('portfolio.json', items.filter(p => p.id !== req.params.id));
  res.json({ success: true });
});

// ── Leads ─────────────────────────────────────────────────────────────────────
app.get('/api/leads', requireAuth, (req, res) => {
  res.json(readData('leads.json'));
});

app.post('/api/contact', (req, res) => {
  const leads = readData('leads.json');
  const lead = {
    ...req.body,
    id: Date.now().toString(),
    date: new Date().toISOString(),
    status: 'new'
  };
  leads.unshift(lead);
  writeData('leads.json', leads);

  // bump monthly lead count
  const analytics = readData('analytics.json');
  analytics.totalLeads = leads.length;
  const monthKey = new Date().toISOString().slice(0, 7);
  const entry = (analytics.monthlyLeads || []).find(m => m.month === monthKey);
  if (entry) {
    entry.count++;
  } else {
    analytics.monthlyLeads = [...(analytics.monthlyLeads || []), { month: monthKey, count: 1 }];
  }
  writeData('analytics.json', analytics);

  res.json({ success: true });
});

app.put('/api/leads/:id', requireAuth, (req, res) => {
  const leads = readData('leads.json');
  const idx = leads.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  leads[idx] = { ...leads[idx], ...req.body };
  writeData('leads.json', leads);
  res.json(leads[idx]);
});

app.delete('/api/leads/:id', requireAuth, (req, res) => {
  const leads = readData('leads.json');
  writeData('leads.json', leads.filter(l => l.id !== req.params.id));
  res.json({ success: true });
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.post('/api/analytics/pageview', (req, res) => {
  const analytics = readData('analytics.json');
  analytics.pageViews = (analytics.pageViews || 0) + 1;
  const today = new Date().toISOString().slice(0, 10);
  analytics.dailyViews = analytics.dailyViews || [];
  const day = analytics.dailyViews.find(d => d.date === today);
  if (day) {
    day.count++;
  } else {
    analytics.dailyViews.push({ date: today, count: 1 });
    if (analytics.dailyViews.length > 30) analytics.dailyViews.shift();
  }
  writeData('analytics.json', analytics);
  res.json({ success: true });
});

app.get('/api/analytics', requireAuth, (req, res) => {
  const analytics = readData('analytics.json');
  const leads = readData('leads.json');
  const portfolio = readData('portfolio.json');
  res.json({
    ...analytics,
    totalLeads: leads.length,
    newLeads: leads.filter(l => l.status === 'new').length,
    portfolioItems: portfolio.length
  });
});

// ── Fallback ──────────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ✦  Studio Prototype running`);
  console.log(`  →  Site:  http://localhost:${PORT}`);
  console.log(`  →  Admin: http://localhost:${PORT}/admin.html`);
  console.log(`  →  Pass:  ${ADMIN_PASSWORD}\n`);
});
