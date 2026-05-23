const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      category TEXT DEFAULT '',
      tags JSONB DEFAULT '[]',
      year TEXT DEFAULT '',
      description TEXT DEFAULT '',
      gradient TEXT DEFAULT '',
      featured BOOLEAN DEFAULT false,
      url TEXT DEFAULT '',
      images JSONB DEFAULT '[]',
      cover_image TEXT DEFAULT '',
      sort_order INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      company TEXT DEFAULT '',
      project TEXT DEFAULT '',
      budget TEXT DEFAULT '',
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'new',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS content (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS page_views (
      date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
      count INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monthly_leads (
      month TEXT PRIMARY KEY,
      count INT DEFAULT 0
    );
  `);

  // Seed default content if empty
  const { rows } = await pool.query(`SELECT key FROM content WHERE key = 'main'`);
  if (rows.length === 0) {
    await pool.query(`
      INSERT INTO content (key, value) VALUES ('main', $1)
    `, [JSON.stringify({
      brand: { name: 'STUDIO', tagline: 'Digital Creative Agency' },
      hero: {
        headline: 'We craft digital\nexperiences that\nmove people.',
        subtext: 'A boutique creative studio obsessed with craft — building brands, websites, and digital products for companies that want to stand out.',
        cta_primary: 'Start a project',
        cta_secondary: 'View our work'
      },
      about: {
        headline: 'We believe great design changes how people feel.',
        body: 'Founded in 2019, we\'re a small team of designers, strategists, and engineers who care deeply about craft. We partner with ambitious companies to build things that last.',
        stat1_number: '60+', stat1_label: 'Projects delivered',
        stat2_number: '12', stat2_label: 'Countries reached',
        stat3_number: '4.9', stat3_label: 'Average rating'
      },
      services: [
        { title: 'Brand Identity', description: 'Strategy, visual identity, guidelines, and brand systems built to scale.' },
        { title: 'Web Design & Dev', description: 'High-performance websites and web apps designed for conversion.' },
        { title: 'Art Direction', description: 'Campaign concepts, photography direction, and creative production.' },
        { title: 'Motion & Interaction', description: 'Animations, micro-interactions, and scroll experiences.' }
      ],
      testimonials: [
        { quote: 'Working with Studio completely transformed how our brand shows up online. The attention to detail is unmatched.', author: 'Sarah Chen', role: 'CEO, Matera' },
        { quote: 'They delivered a website that increased our conversion rate by 40%. Not just beautiful — it performs.', author: 'Marcus Webb', role: 'Founder, Silvr' },
        { quote: 'The team understood our vision immediately and elevated it beyond what we imagined.', author: 'Léa Fontaine', role: 'Creative Director, Intramuros' }
      ],
      footer: { tagline: 'Building the future of digital experience.' }
    })]);
  }

  // Seed default portfolio if empty
  const { rows: pRows } = await pool.query(`SELECT id FROM portfolio LIMIT 1`);
  if (pRows.length === 0) {
    const projects = [
      { id: '1', title: 'Matera', category: 'Brand Identity', tags: ['Branding','Web'], year: '2025', description: 'Complete brand overhaul for a sustainable architecture studio.', gradient: 'linear-gradient(135deg, #1a2830 0%, #0a1520 100%)', featured: true, sort_order: 0 },
      { id: '2', title: 'Silvr', category: 'Web Design', tags: ['Web','Motion'], year: '2025', description: 'Financial technology platform redesign.', gradient: 'linear-gradient(135deg, #0e4d4d 0%, #072d2d 100%)', featured: true, sort_order: 1 },
      { id: '3', title: 'Chance', category: 'Art Direction', tags: ['Art Direction','Campaign'], year: '2024', description: 'Campaign art direction for a luxury fragrance launch.', gradient: 'linear-gradient(135deg, #8b3a0f 0%, #4a1a05 100%)', featured: true, sort_order: 2 },
      { id: '4', title: 'Intramuros', category: 'Brand Identity', tags: ['Branding','Strategy'], year: '2024', description: 'Brand strategy and identity for a cultural magazine.', gradient: 'linear-gradient(135deg, #4a1942 0%, #220d1e 100%)', featured: false, sort_order: 3 },
      { id: '5', title: 'Noma', category: 'Web Design', tags: ['Web','UI/UX'], year: '2024', description: 'Minimal e-commerce experience for a Scandinavian homewares brand.', gradient: 'linear-gradient(135deg, #1c1c1c 0%, #0a0a0a 100%)', featured: false, sort_order: 4 },
      { id: '6', title: 'Soleil', category: 'Art Direction', tags: ['Art Direction','Print'], year: '2024', description: 'Seasonal lookbook art direction for a Paris-based label.', gradient: 'linear-gradient(135deg, #3d2b1f 0%, #1e1208 100%)', featured: false, sort_order: 5 },
      { id: '7', title: 'Forma', category: 'Brand Identity', tags: ['Branding','Motion'], year: '2023', description: 'Dynamic identity system for an architecture collective.', gradient: 'linear-gradient(135deg, #0d1f3c 0%, #060d1a 100%)', featured: false, sort_order: 6 },
      { id: '8', title: 'Drift', category: 'Web Design', tags: ['Web','Interaction'], year: '2023', description: 'Immersive portfolio site for a motion studio.', gradient: 'linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)', featured: false, sort_order: 7 }
    ];
    for (const p of projects) {
      await pool.query(`
        INSERT INTO portfolio (id, title, category, tags, year, description, gradient, featured, url, images, cover_image, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO NOTHING
      `, [p.id, p.title, p.category, JSON.stringify(p.tags || []), p.year, p.description, p.gradient, p.featured, p.url || '', JSON.stringify(p.images || []), p.cover_image || '', p.sort_order]);
    }
  }

  console.log('  ✦  Database ready');
}

module.exports = { pool, init };
