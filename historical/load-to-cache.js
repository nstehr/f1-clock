#!/usr/bin/env node
// Load a generated historical race into the main app's SQLite cache

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);

if (args.length < 1) {
  console.log(`
Load a historical race JSON into the main app cache.

Usage:
  node load-to-cache.js <json-file> [session-key]

Examples:
  node load-to-cache.js output/1998-06-circuit-de-monaco.json
  node load-to-cache.js output/1998-06-circuit-de-monaco.json -19986

If session-key is not provided, one will be generated from the filename.
Use negative numbers to avoid conflicts with real OpenF1 session keys.
`);
  process.exit(0);
}

const jsonFile = args[0];
const providedKey = args[1] ? parseInt(args[1], 10) : null;

// Find the cache database
const dbPath = process.env.F1_CACHE_DB || path.join(__dirname, '..', 'f1cache.db');

if (!fs.existsSync(jsonFile)) {
  console.error(`File not found: ${jsonFile}`);
  process.exit(1);
}

// Load the race data
const raceData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
console.log(`Loaded: ${raceData.title}`);

// Generate a session key if not provided
// Use negative numbers to distinguish from real OpenF1 keys
let sessionKey = providedKey;
if (!sessionKey) {
  // Extract year and round from filename like "1998-06-circuit-de-monaco.json"
  const match = path.basename(jsonFile).match(/^(\d{4})-(\d{2})/);
  if (match) {
    sessionKey = -(parseInt(match[1], 10) * 100 + parseInt(match[2], 10));
  } else {
    sessionKey = -Date.now(); // fallback
  }
}

console.log(`Session key: ${sessionKey}`);
console.log(`Database: ${dbPath}`);

// Open database and insert
const db = new Database(dbPath);

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS races (
    session_key INTEGER PRIMARY KEY,
    data TEXT
  );
`);

// Insert or replace
db.prepare('INSERT OR REPLACE INTO races (session_key, data) VALUES (?, ?)').run(
  sessionKey,
  JSON.stringify(raceData)
);

console.log(`Inserted into cache with key ${sessionKey}`);

// List all cached races
const races = db.prepare('SELECT session_key FROM races ORDER BY session_key').all();
console.log(`\nCached races: ${races.length}`);
for (const r of races.slice(-5)) {
  const data = JSON.parse(db.prepare('SELECT data FROM races WHERE session_key = ?').get(r.session_key).data);
  console.log(`  ${r.session_key}: ${data.title}`);
}
if (races.length > 5) {
  console.log(`  ... and ${races.length - 5} more`);
}

db.close();
console.log('\nDone! Restart the server to pick up the new race.');
