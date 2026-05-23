const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { pool, init } = require('./db');
const sharp = require('sharp');

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

// In-memory session tokens
const sessions = new Set();
function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
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

app.get('/api/auth/check', requireAuth, (req, res) => res.json({ authenticated: true }));

// ── Content ───────────────────────────────────────────────────────────────────
app.get('/api/content', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM content WHERE key = 'main'`);
    res.json(rows[0]?.value || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/content', requireAuth, async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO content (key, value) VALUES ('main', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1
    `, [JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Image Upload ──────────────────────────────────────────────────────────────
const CARD_W = 1191, CARD_H = 842;

app.post('/api/upload', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const filePath = req.file.path;
    const ext = path.extname(req.file.filename).toLowerCase();
    const outName = req.file.filename.replace(ext, '.jpg');
    const outPath = path.join(uploadsDir, outName);

    await sharp(filePath)
      .resize(CARD_W, CARD_H, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(outPath);

    // Remove original if different filename
    if (outName !== req.file.filename) {
      try { fs.unlinkSync(filePath); } catch {}
    }

    res.json({ url: `/uploads/${outName}` });
  } catch (e) {
    // Fallback: serve original if sharp fails
    res.json({ url: `/uploads/${req.file.filename}` });
  }
});

app.delete('/api/upload', requireAuth, (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('/uploads/')) return res.status(400).json({ error: 'Invalid url' });
  try { fs.unlinkSync(path.join(__dirname, 'public', url)); } catch {}
  res.json({ success: true });
});

// ── Portfolio ─────────────────────────────────────────────────────────────────
function rowToProject(r) {
  return {
    id: r.id, title: r.title, category: r.category,
    tags: r.tags || [], year: r.year, description: r.description,
    gradient: r.gradient, featured: r.featured, url: r.url,
    images: r.images || [], coverImage: r.cover_image
  };
}

app.get('/api/portfolio', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM portfolio ORDER BY sort_order ASC, id ASC`);
    res.json(rows.map(rowToProject));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/portfolio', requireAuth, async (req, res) => {
  try {
    const { title='', category='', tags=[], year='', description='', gradient='', featured=false, url='', images=[], coverImage='' } = req.body;
    const id = Date.now().toString();
    const { rows: maxRows } = await pool.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM portfolio`);
    const sort_order = maxRows[0].next;
    const { rows } = await pool.query(`
      INSERT INTO portfolio (id, title, category, tags, year, description, gradient, featured, url, images, cover_image, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [id, title, category, JSON.stringify(tags), year, description, gradient, featured, url, JSON.stringify(images), coverImage, sort_order]);
    res.json(rowToProject(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/portfolio/reorder', requireAuth, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
    for (let i = 0; i < order.length; i++) {
      await pool.query(`UPDATE portfolio SET sort_order = $1 WHERE id = $2`, [i, order[i]]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/portfolio/:id/duplicate', requireAuth, async (req, res) => {
  try {
    const { rows: src } = await pool.query(`SELECT * FROM portfolio WHERE id = $1`, [req.params.id]);
    if (!src.length) return res.status(404).json({ error: 'Not found' });
    const p = src[0];
    const newId = Date.now().toString();
    const { rows } = await pool.query(`
      INSERT INTO portfolio (id, title, category, tags, year, description, gradient, featured, url, images, cover_image, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [newId, p.title+' (Copy)', p.category, JSON.stringify(p.tags), p.year, p.description, p.gradient, false, p.url, JSON.stringify(p.images), p.cover_image, p.sort_order+1]);
    res.json(rowToProject(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/portfolio/:id', requireAuth, async (req, res) => {
  try {
    const { title, category, tags, year, description, gradient, featured, url, images, coverImage } = req.body;
    const { rows } = await pool.query(`
      UPDATE portfolio SET
        title = COALESCE($2, title),
        category = COALESCE($3, category),
        tags = COALESCE($4, tags),
        year = COALESCE($5, year),
        description = COALESCE($6, description),
        gradient = COALESCE($7, gradient),
        featured = COALESCE($8, featured),
        url = COALESCE($9, url),
        images = COALESCE($10, images),
        cover_image = COALESCE($11, cover_image)
      WHERE id = $1 RETURNING *
    `, [req.params.id, title, category, tags ? JSON.stringify(tags) : null, year, description, gradient, featured, url, images ? JSON.stringify(images) : null, coverImage]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rowToProject(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/portfolio/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM portfolio WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Leads ─────────────────────────────────────────────────────────────────────
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM leads ORDER BY created_at DESC`);
    res.json(rows.map(r => ({ ...r, date: r.created_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/contact', async (req, res) => {
  try {
    const { name='', email='', company='', project='', budget='', message='' } = req.body;
    const id = Date.now().toString();
    await pool.query(`
      INSERT INTO leads (id, name, email, company, project, budget, message)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [id, name, email, company, project, budget, message]);

    // bump monthly lead count
    const monthKey = new Date().toISOString().slice(0, 7);
    await pool.query(`
      INSERT INTO monthly_leads (month, count) VALUES ($1, 1)
      ON CONFLICT (month) DO UPDATE SET count = monthly_leads.count + 1
    `, [monthKey]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows } = await pool.query(
      `UPDATE leads SET status = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, status]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ...rows[0], date: rows[0].created_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM leads WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.post('/api/analytics/pageview', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO page_views (date, count) VALUES ($1, 1)
      ON CONFLICT (date) DO UPDATE SET count = page_views.count + 1
    `, [today]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

app.get('/api/analytics', requireAuth, async (req, res) => {
  try {
    const [views, monthly, leads, portfolio] = await Promise.all([
      pool.query(`SELECT SUM(count) AS total, json_agg(json_build_object('date', date, 'count', count) ORDER BY date DESC) AS daily FROM page_views WHERE date >= CURRENT_DATE - 29`),
      pool.query(`SELECT * FROM monthly_leads ORDER BY month DESC LIMIT 12`),
      pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='new') AS new_count FROM leads`),
      pool.query(`SELECT COUNT(*) AS total FROM portfolio`)
    ]);
    res.json({
      pageViews: parseInt(views.rows[0]?.total || 0),
      dailyViews: (views.rows[0]?.daily || []).reverse(),
      monthlyLeads: monthly.rows.map(r => ({ month: r.month, count: r.count })),
      totalLeads: parseInt(leads.rows[0]?.total || 0),
      newLeads: parseInt(leads.rows[0]?.new_count || 0),
      portfolioItems: parseInt(portfolio.rows[0]?.total || 0)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Fallback ──────────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  ✦  Studio running on port ${PORT}`);
    console.log(`  →  Site:  http://localhost:${PORT}`);
    console.log(`  →  Admin: http://localhost:${PORT}/admin.html`);
    console.log(`  →  Pass:  ${ADMIN_PASSWORD}\n`);
  });
}).catch(err => {
  console.error('Database init failed:', err.message);
  // Still start server even without DB (local dev fallback)
  app.listen(PORT, () => console.log(`  ✦  Studio running (no DB) on port ${PORT}`));
});
