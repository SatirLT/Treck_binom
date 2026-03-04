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
    client_hash TEXT,
    ip TEXT,
    user_agent TEXT,
    referer TEXT,
    screen_width TEXT,
    screen_height TEXT,
    language TEXT,
    timezone TEXT,
    sub_params TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'clicked'
  );

  CREATE INDEX IF NOT EXISTS idx_clicks_client_hash ON clicks(client_hash);
  CREATE INDEX IF NOT EXISTS idx_clicks_click_id ON clicks(click_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_ip ON clicks(ip);
  CREATE INDEX IF NOT EXISTS idx_clicks_status ON clicks(status);

  CREATE TABLE IF NOT EXISTS installs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id TEXT,
    client_hash TEXT,
    device_id TEXT,
    idfa TEXT,
    idfv TEXT,
    bundle_id TEXT,
    app_version TEXT,
    os_version TEXT,
    device_model TEXT,
    screen_width TEXT,
    screen_height TEXT,
    language TEXT,
    timezone TEXT,
    ip TEXT,
    matched_click_id TEXT,
    match_method TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    postback_sent INTEGER DEFAULT 0,
    FOREIGN KEY (matched_click_id) REFERENCES clicks(click_id)
  );

  CREATE INDEX IF NOT EXISTS idx_installs_client_hash ON installs(client_hash);
  CREATE INDEX IF NOT EXISTS idx_installs_device_id ON installs(device_id);
`);

// === Prepared statements ===

const insertClick = db.prepare(`
  INSERT INTO clicks (click_id, binom_click_id, client_hash, ip, user_agent, referer, sub_params)
  VALUES (@click_id, @binom_click_id, @client_hash, @ip, @user_agent, @referer, @sub_params)
`);

const findClickById = db.prepare(`
  SELECT * FROM clicks WHERE click_id = @click_id
`);

// Метод 1: Поиск по client_hash (хэш с лендинга = хэш из приложения)
const findClickByClientHash = db.prepare(`
  SELECT * FROM clicks
  WHERE client_hash = @client_hash AND client_hash IS NOT NULL
    AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Метод 2: Поиск по IP + разрешение экрана + язык + таймзона
const findClickByIpAndParams = db.prepare(`
  SELECT * FROM clicks
  WHERE ip = @ip
    AND screen_width = @screen_width AND screen_height = @screen_height
    AND language = @language AND timezone = @timezone
    AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Метод 3: Поиск по IP + разрешение экрана (без языка и таймзоны)
const findClickByIpAndScreen = db.prepare(`
  SELECT * FROM clicks
  WHERE ip = @ip
    AND screen_width = @screen_width AND screen_height = @screen_height
    AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Метод 4: Поиск только по IP (последний шанс, наименее точный)
const findClickByIp = db.prepare(`
  SELECT * FROM clicks
  WHERE ip = @ip AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

const updateClickStatus = db.prepare(`
  UPDATE clicks SET status = @status WHERE click_id = @click_id
`);

const insertInstall = db.prepare(`
  INSERT INTO installs (click_id, client_hash, device_id, idfa, idfv, bundle_id, app_version, os_version, device_model, screen_width, screen_height, language, timezone, ip, matched_click_id, match_method)
  VALUES (@click_id, @client_hash, @device_id, @idfa, @idfv, @bundle_id, @app_version, @os_version, @device_model, @screen_width, @screen_height, @language, @timezone, @ip, @matched_click_id, @match_method)
`);

const markPostbackSent = db.prepare(`
  UPDATE installs SET postback_sent = 1 WHERE id = @id
`);

module.exports = {
  db,
  insertClick,
  findClickById,
  findClickByClientHash,
  findClickByIpAndParams,
  findClickByIpAndScreen,
  findClickByIp,
  updateClickStatus,
  insertInstall,
  markPostbackSent,
};
