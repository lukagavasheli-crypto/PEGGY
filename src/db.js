const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'notifications.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL,
    summary TEXT NOT NULL,
    tagged_by TEXT NOT NULL,
    tagged_by_img TEXT,
    file_name TEXT,
    timestamp TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_source_id ON notifications(source_id);
  CREATE INDEX IF NOT EXISTS idx_status ON notifications(status);
  CREATE INDEX IF NOT EXISTS idx_timestamp ON notifications(timestamp DESC);

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    priority TEXT DEFAULT 'low',
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS poll_state (
    source TEXT NOT NULL,
    resource_key TEXT NOT NULL,
    last_polled_at TEXT NOT NULL,
    PRIMARY KEY (source, resource_key)
  );
`);

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO notifications (source, source_id, source_url, summary, tagged_by, tagged_by_img, file_name, timestamp)
  VALUES (@source, @source_id, @source_url, @summary, @tagged_by, @tagged_by_img, @file_name, @timestamp)
`);

function insertNotification(n) {
  const result = insertStmt.run(n);
  if (result.changes > 0) {
    return getNotification(result.lastInsertRowid);
  }
  return null; // duplicate
}

function getNotification(id) {
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}

function getAllNotifications() {
  return db.prepare("SELECT * FROM notifications WHERE status != 'seen' ORDER BY timestamp DESC").all();
}

function markSeen(id) {
  db.prepare("UPDATE notifications SET status = 'seen' WHERE id = ?").run(id);
}

function markAllSeen() {
  db.prepare("UPDATE notifications SET status = 'seen' WHERE status = 'new'").run();
}

function getHighWaterMark(source, resourceKey) {
  const row = db.prepare('SELECT last_polled_at FROM poll_state WHERE source = ? AND resource_key = ?').get(source, resourceKey);
  return row ? row.last_polled_at : null;
}

function setHighWaterMark(source, resourceKey, timestamp) {
  db.prepare(`
    INSERT INTO poll_state (source, resource_key, last_polled_at)
    VALUES (?, ?, ?)
    ON CONFLICT(source, resource_key) DO UPDATE SET last_polled_at = excluded.last_polled_at
  `).run(source, resourceKey, timestamp);
}

function purgeOlderThan(days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare("DELETE FROM notifications WHERE timestamp < ?").run(cutoff);
  if (result.changes > 0) console.log(`[db] Purged ${result.changes} notifications older than ${days} days`);
}

// Purge on load
purgeOlderThan(7);

// --- Todos ---

function getAllTodos() {
  return db.prepare('SELECT * FROM todos WHERE done = 0 ORDER BY created_at DESC').all();
}

function insertTodo(text, priority) {
  const result = db.prepare('INSERT INTO todos (text, priority) VALUES (?, ?)').run(text, priority || 'low');
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
}

function updateTodo(id, fields) {
  const sets = [];
  const vals = [];
  if (fields.text !== undefined) { sets.push('text = ?'); vals.push(fields.text); }
  if (fields.priority !== undefined) { sets.push('priority = ?'); vals.push(fields.priority); }
  if (fields.done !== undefined) { sets.push('done = ?'); vals.push(fields.done ? 1 : 0); }
  if (sets.length === 0) return null;
  vals.push(id);
  db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
}

function deleteTodo(id) {
  db.prepare('DELETE FROM todos WHERE id = ?').run(id);
}

module.exports = {
  insertNotification,
  getNotification,
  getAllNotifications,
  markSeen,
  markAllSeen,
  getHighWaterMark,
  setHighWaterMark,
  getAllTodos,
  insertTodo,
  updateTodo,
  deleteTodo,
};
