const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.F1_CACHE_DB || path.join(__dirname, '..', 'f1cache.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS races (
    session_key INTEGER PRIMARY KEY,
    data TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY DEFAULT 1,
    data TEXT,
    fetched_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS rejected (
    session_key INTEGER PRIMARY KEY
  );
`);

function getSessions() {
  const row = db.prepare('SELECT data, fetched_at FROM sessions WHERE id = 1').get();
  if (!row) return null;
  // Cache sessions for 24 hours
  if (Date.now() - row.fetched_at > 86400000) return null;
  return JSON.parse(row.data);
}

function setSessions(sessions) {
  db.prepare('INSERT OR REPLACE INTO sessions (id, data, fetched_at) VALUES (1, ?, ?)').run(
    JSON.stringify(sessions), Date.now()
  );
}

function getRace(sessionKey) {
  const row = db.prepare('SELECT data FROM races WHERE session_key = ?').get(sessionKey);
  return row ? JSON.parse(row.data) : null;
}

function setRace(sessionKey, data) {
  db.prepare('INSERT OR REPLACE INTO races (session_key, data) VALUES (?, ?)').run(
    sessionKey, JSON.stringify(data)
  );
}

function getCachedSessionKeys() {
  const rows = db.prepare('SELECT session_key FROM races').all();
  return new Set(rows.map(r => r.session_key));
}

function getCachedRaceKeys() {
  const rows = db.prepare('SELECT session_key FROM races').all();
  return rows.map(r => r.session_key);
}

function isRejected(sessionKey) {
  return !!db.prepare('SELECT 1 FROM rejected WHERE session_key = ?').get(sessionKey);
}

function setRejected(sessionKey) {
  db.prepare('INSERT OR IGNORE INTO rejected (session_key) VALUES (?)').run(sessionKey);
}

module.exports = { getSessions, setSessions, getRace, setRace, getCachedSessionKeys, getCachedRaceKeys, isRejected, setRejected };
