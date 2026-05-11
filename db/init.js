// Run this once to initialize the database schema:
//   node db/init.js
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function init() {
  console.log('[init] Connecting to Neon...');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('[init] ✓ Schema applied successfully');
  } catch (err) {
    console.error('[init] ✗ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
