const express = require('express');
const { Pool } = require('pg');
const puppeteer = require('puppeteer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection Setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Initialize database schema safely
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resumes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100),
        summary TEXT,
        experience TEXT,
        education TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err) {
    console.error("Database initialization deferred/failed:", err.message);
  }
};
initDb();

// Main Route - Serves the form creation dashboard
app.get('/', (req, res) => {
  res.render('form');
});

// PDF Generation & Optional Database Storage Endpoint
app.post('/generate-pdf', async (req, res) => {
  let { name, email, summary, experience, education, saveToDb } = req.body;

  // Handle multiple dynamically added experience fields
  if (Array.isArray(experience)) {
    experience = experience.filter(item => item.trim() !== "").join('\n\n');
  }

  // Database persistence layer
  if (saveToDb === 'true') {
    try {
      await pool.query(
        'INSERT INTO resumes (name, email, summary, experience, education) VALUES ($1, $2, $3, $4, $5)',
        [name, email, summary, experience, education]
      );
    } catch (err) {
      console.error("Data tracking skipped/failed:", err.message);
    }
  }

  try {
    // Generate layout using templating engine
    res.render('template', { name, email, summary, experience, education }, async (err, html) => {
      if (err) return res.status(500).send("Template structural compilation error.");

      // Boot virtual headless chrome container configured for Heroku architecture environments
      const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
      });

      await browser.close();

      // Dispatch binary document stream back to user's client attachment target
      res.contentType("application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/\s+/g, '_')}_Resume.pdf"`);
      res.send(pdfBuffer);
    });
  } catch (error) {
    console.error("Headless compiling exception:", error);
    res.status(500).send("An error occurred executing your PDF request.");
  }
});

app.listen(PORT, () => {
  console.log(`Application actively polling on port ${PORT}`);
});