const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Ensure data directory exists
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id TEXT UNIQUE NOT NULL,
    binom_click_id TEXT,
    fingerprint TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    referer TEXT,
    landing_url TEXT,
    sub_params TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'clicked'
  );

  CREATE INDEX IF NOT EXISTS idx_clicks_fingerprint ON clicks(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_clicks_click_id ON clicks(click_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_status ON clicks(status);

  CREATE TABLE IF NOT EXISTS installs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id TEXT,
    device_id TEXT,
    idfa TEXT,
    idfv TEXT,
    bundle_id TEXT,
    app_version TEXT,
    os_version TEXT,
    device_model TEXT,
    fingerprint TEXT,
    ip TEXT,
    matched_click_id TEXT,
    match_method TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    postback_sent INTEGER DEFAULT 0,
    FOREIGN KEY (matched_click_id) REFERENCES clicks(click_id)
  );

  CREATE INDEX IF NOT EXISTS idx_installs_fingerprint ON installs(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_installs_device_id ON installs(device_id);
`);

// Prepared statements
const insertClick = db.prepare(`
  INSERT INTO clicks (click_id, binom_click_id, fingerprint, ip, user_agent, referer, sub_params)
  VALUES (@click_id, @binom_click_id, @fingerprint, @ip, @user_agent, @referer, @sub_params)
`);

const findClickByFingerprint = db.prepare(`
  SELECT * FROM clicks
  WHERE fingerprint = @fingerprint AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

const findClickById = db.prepare(`
  SELECT * FROM clicks WHERE click_id = @click_id
`);

const updateClickStatus = db.prepare(`
  UPDATE clicks SET status = @status WHERE click_id = @click_id
`);

const insertInstall = db.prepare(`
  INSERT INTO installs (click_id, device_id, idfa, idfv, bundle_id, app_version, os_version, device_model, fingerprint, ip, matched_click_id, match_method)
  VALUES (@click_id, @device_id, @idfa, @idfv, @bundle_id, @app_version, @os_version, @device_model, @fingerprint, @ip, @matched_click_id, @match_method)
`);

const markPostbackSent = db.prepare(`
  UPDATE installs SET postback_sent = 1 WHERE id = @id
`);

module.exports = {
  db,
  insertClick,
  findClickByFingerprint,
  findClickById,
  updateClickStatus,
  insertInstall,
  markPostbackSent,
};
