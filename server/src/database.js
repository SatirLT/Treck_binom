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
    os_version TEXT,
    dpr TEXT,
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
    dpr TEXT,
    language TEXT,
    timezone TEXT,
    ip TEXT,
    matched_click_id TEXT,
    match_method TEXT,
    attribution_status TEXT DEFAULT 'organic',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    postback_sent INTEGER DEFAULT 0,
    FOREIGN KEY (matched_click_id) REFERENCES clicks(click_id)
  );

  CREATE INDEX IF NOT EXISTS idx_installs_client_hash ON installs(client_hash);
  CREATE INDEX IF NOT EXISTS idx_installs_device_id ON installs(device_id);
  CREATE INDEX IF NOT EXISTS idx_installs_idfv ON installs(idfv);
`);

// === Prepared statements ===

const insertClick = db.prepare(`
  INSERT INTO clicks (click_id, binom_click_id, client_hash, ip, user_agent, referer, sub_params)
  VALUES (@click_id, @binom_click_id, @client_hash, @ip, @user_agent, @referer, @sub_params)
`);

const findClickById = db.prepare(`
  SELECT * FROM clicks WHERE click_id = @click_id
`);

// Ступень 2: Поиск по client_hash
const findClickByClientHash = db.prepare(`
  SELECT * FROM clicks
  WHERE client_hash = @client_hash AND client_hash IS NOT NULL
    AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Ступень 3: IP + экран + язык + таймзона + OS version
const findClickByIpAndAllParams = db.prepare(`
  SELECT * FROM clicks
  WHERE ip = @ip
    AND screen_width = @screen_width AND screen_height = @screen_height
    AND language = @language AND timezone = @timezone
    AND os_version = @os_version
    AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Ступень 4: IP + экран + язык + таймзона (без OS version)
const findClickByIpAndParams = db.prepare(`
  SELECT * FROM clicks
  WHERE ip = @ip
    AND screen_width = @screen_width AND screen_height = @screen_height
    AND language = @language AND timezone = @timezone
    AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Ступень 5: IP + экран
const findClickByIpAndScreen = db.prepare(`
  SELECT * FROM clicks
  WHERE ip = @ip
    AND screen_width = @screen_width AND screen_height = @screen_height
    AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Ступень 6: Только IP
const findClickByIp = db.prepare(`
  SELECT * FROM clicks
  WHERE ip = @ip AND status = 'clicked'
  ORDER BY created_at DESC
  LIMIT 1
`);

// Поиск установки по device_id или idfv (для /status и /event)
const findInstallByDevice = db.prepare(`
  SELECT i.*, c.binom_click_id, c.sub_params as click_sub_params
  FROM installs i
  LEFT JOIN clicks c ON i.matched_click_id = c.click_id
  WHERE i.device_id = @device_id OR i.idfv = @idfv
  ORDER BY i.created_at DESC
  LIMIT 1
`);

// Поиск установки по client_hash (fallback для /status)
const findInstallByClientHash = db.prepare(`
  SELECT i.*, c.binom_click_id, c.sub_params as click_sub_params
  FROM installs i
  LEFT JOIN clicks c ON i.matched_click_id = c.click_id
  WHERE i.client_hash = @client_hash AND i.client_hash IS NOT NULL
  ORDER BY i.created_at DESC
  LIMIT 1
`);

const updateClickStatus = db.prepare(`
  UPDATE clicks SET status = @status WHERE click_id = @click_id
`);

const insertInstall = db.prepare(`
  INSERT INTO installs (click_id, client_hash, device_id, idfa, idfv, bundle_id, app_version, os_version, device_model, screen_width, screen_height, dpr, language, timezone, ip, matched_click_id, match_method, attribution_status)
  VALUES (@click_id, @client_hash, @device_id, @idfa, @idfv, @bundle_id, @app_version, @os_version, @device_model, @screen_width, @screen_height, @dpr, @language, @timezone, @ip, @matched_click_id, @match_method, @attribution_status)
`);

const markPostbackSent = db.prepare(`
  UPDATE installs SET postback_sent = 1 WHERE id = @id
`);

module.exports = {
  db,
  insertClick,
  findClickById,
  findClickByClientHash,
  findClickByIpAndAllParams,
  findClickByIpAndParams,
  findClickByIpAndScreen,
  findClickByIp,
  findInstallByDevice,
  findInstallByClientHash,
  updateClickStatus,
  insertInstall,
  markPostbackSent,
};
