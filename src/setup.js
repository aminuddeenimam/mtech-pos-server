// One-time setup script: creates tables, locations, and initial user accounts.
// Run with: node src/setup.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./db');

async function run() {
  console.log('Creating tables...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Tables ready.');

  // ---- Locations ----
  const locations = ['M-Tech General Merchandise', 'Mujahid Comms'];
  const locationIds = {};
  for (const name of locations) {
    const { rows } = await pool.query(
      `INSERT INTO locations (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [name]
    );
    locationIds[name] = rows[0].id;
    console.log(`Location ready: ${name} (id=${rows[0].id})`);
  }

  // ---- Owner account ----
  // CHANGE THIS PASSWORD before going live. This is just a starting credential.
  const ownerUsername = 'muhammad';
  const ownerPassword = 'changeme123';
  const ownerHash = await bcrypt.hash(ownerPassword, 10);

  await pool.query(
    `INSERT INTO users (name, username, password_hash, role, location_id)
     VALUES ($1, $2, $3, 'owner', NULL)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    ['Muhammad', ownerUsername, ownerHash]
  );
  console.log(`Owner account ready: username="${ownerUsername}" password="${ownerPassword}"`);
  console.log('⚠️  Change this password after first login.');

  console.log('\nSetup complete. Locations and owner account are ready.');
  console.log('To add staff accounts, use POST /api/users once the server is running, or extend this script.');

  await pool.end();
}

run().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
