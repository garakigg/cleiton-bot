import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = join(process.cwd(), 'data', 'cleiton.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  chat_id TEXT,
  chat_name TEXT,
  user_id TEXT,
  message TEXT
);

CREATE TABLE IF NOT EXISTS groups (
  chat_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  participants INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warnings (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS mutes (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  until_ts INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS warning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  admin_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  media INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS bot_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS link_whitelist (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS blocked_words (
  chat_id TEXT NOT NULL,
  word TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, word)
);

CREATE TABLE IF NOT EXISTS user_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_profiles (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  phone_jid TEXT,
  lid_jid TEXT,
  name TEXT,
  photo_path TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  photo_updated_at TEXT,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_profiles_phone ON member_profiles (chat_id, phone_jid);
CREATE INDEX IF NOT EXISTS idx_member_profiles_lid ON member_profiles (chat_id, lid_jid);

CREATE TABLE IF NOT EXISTS roulette_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  challenged_id TEXT NOT NULL,
  current_shooter_id TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL DEFAULT 6,
  bullet_round INTEGER NOT NULL,
  risk_level INTEGER NOT NULL DEFAULT 2,
  winner_id TEXT,
  loser_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_roulette_games_chat_status ON roulette_games (chat_id, status);

CREATE TABLE IF NOT EXISTS roulette_stats (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  medals INTEGER NOT NULL DEFAULT 0,
  shots INTEGER NOT NULL DEFAULT 0,
  survived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);
`);

try {
  db.exec('ALTER TABLE roulette_games ADD COLUMN risk_level INTEGER NOT NULL DEFAULT 2');
} catch {}

export function seedDefaults(defaults) {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, String(value));
  }
}

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

export function getSettings() {
  return db.prepare('SELECT key, value FROM settings ORDER BY key').all();
}

export function exportSettingsObject() {
  const rows = getSettings();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function logEvent({ level = 'info', event, chat, userId = '', message = '' }) {
  db.prepare(`
    INSERT INTO logs (level, event, chat_id, chat_name, user_id, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(level, event, chat?.id?._serialized || '', chat?.name || '', userId, message);
}

export function addHistory(chatId, userId, action, actorId = '', detail = '') {
  db.prepare(`
    INSERT INTO user_history (chat_id, user_id, action, actor_id, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, userId, action, actorId, detail);
}

export function userHistory(chatId, userId, limit = 15) {
  return db.prepare(`
    SELECT * FROM user_history
    WHERE chat_id = ? AND user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(chatId, userId, limit);
}

export function recentLogs(limit = 100) {
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit);
}

export function upsertGroup(chat) {
  db.prepare(`
    INSERT INTO groups (chat_id, name, participants, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET
      name = excluded.name,
      participants = excluded.participants,
      updated_at = datetime('now')
  `).run(chat.id._serialized, chat.name || 'Grupo sem nome', chat.participants?.length || 0);
}

export function listGroups() {
  return db.prepare('SELECT * FROM groups ORDER BY updated_at DESC').all();
}

export function addWarning(chatId, userId) {
  db.prepare(`
    INSERT INTO warnings (chat_id, user_id, count, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      count = count + 1,
      updated_at = datetime('now')
  `).run(chatId, userId);

  return db.prepare('SELECT count FROM warnings WHERE chat_id = ? AND user_id = ?').get(chatId, userId)?.count || 1;
}

export function addWarningEvent(chatId, userId, adminId = '', reason = '') {
  const count = addWarning(chatId, userId);
  db.prepare(`
    INSERT INTO warning_events (chat_id, user_id, admin_id, reason)
    VALUES (?, ?, ?, ?)
  `).run(chatId, userId, adminId, reason);
  addHistory(chatId, userId, 'warn', adminId, reason);
  return count;
}

export function getWarningCount(chatId, userId) {
  return db.prepare('SELECT count FROM warnings WHERE chat_id = ? AND user_id = ?')
    .get(chatId, userId)?.count || 0;
}

export function clearWarnings(chatId, userId) {
  db.prepare('DELETE FROM warnings WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  db.prepare('DELETE FROM warning_events WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
}

export function listMutes(chatId, nowTs = Math.floor(Date.now() / 1000)) {
  return db.prepare('SELECT * FROM mutes WHERE chat_id = ? AND until_ts > ? ORDER BY until_ts ASC')
    .all(chatId, nowTs);
}

export function muteUser(chatId, userId, untilTs, reason = '') {
  db.prepare(`
    INSERT INTO mutes (chat_id, user_id, until_ts, reason)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      until_ts = excluded.until_ts,
      reason = excluded.reason
  `).run(chatId, userId, untilTs, reason);
  addHistory(chatId, userId, 'mute', '', reason);
}

export function unmuteUser(chatId, userId) {
  db.prepare('DELETE FROM mutes WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  addHistory(chatId, userId, 'unmute');
}

export function getActiveMute(chatId, userId, nowTs = Math.floor(Date.now() / 1000)) {
  const row = db.prepare('SELECT * FROM mutes WHERE chat_id = ? AND user_id = ? AND until_ts > ?')
    .get(chatId, userId, nowTs);
  if (!row) {
    db.prepare('DELETE FROM mutes WHERE chat_id = ? AND user_id = ? AND until_ts <= ?').run(chatId, userId, nowTs);
  }
  return row;
}

export function recordActivity(chatId, userId, hasMedia = false) {
  db.prepare(`
    INSERT INTO activity (chat_id, user_id, messages, media, updated_at)
    VALUES (?, ?, 1, ?, datetime('now'))
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      messages = messages + 1,
      media = media + excluded.media,
      updated_at = datetime('now')
  `).run(chatId, userId, hasMedia ? 1 : 0);
}

export function topActivity(chatId, limit = 10) {
  return db.prepare(`
    SELECT * FROM activity
    WHERE chat_id = ?
    ORDER BY messages DESC
    LIMIT ?
  `).all(chatId, limit);
}

export function upsertMemberProfile({ chatId, userId, phoneJid = '', lidJid = '', name = '', photoPath = '' }) {
  db.prepare(`
    INSERT INTO member_profiles (chat_id, user_id, phone_jid, lid_jid, name, photo_path, updated_at, photo_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), CASE WHEN ? != '' THEN datetime('now') ELSE NULL END)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      phone_jid = COALESCE(NULLIF(excluded.phone_jid, ''), member_profiles.phone_jid),
      lid_jid = COALESCE(NULLIF(excluded.lid_jid, ''), member_profiles.lid_jid),
      name = COALESCE(NULLIF(excluded.name, ''), member_profiles.name),
      photo_path = COALESCE(NULLIF(excluded.photo_path, ''), member_profiles.photo_path),
      updated_at = datetime('now'),
      photo_updated_at = CASE
        WHEN excluded.photo_path != '' THEN datetime('now')
        ELSE member_profiles.photo_updated_at
      END
  `).run(chatId, userId, phoneJid, lidJid, name, photoPath, photoPath);
}

export function findMemberProfile(chatId, ...jids) {
  const values = [...new Set(jids.filter(Boolean))];
  if (!chatId || !values.length) return null;
  const placeholders = values.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM member_profiles
    WHERE chat_id = ?
      AND (user_id IN (${placeholders}) OR phone_jid IN (${placeholders}) OR lid_jid IN (${placeholders}))
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(chatId, ...values, ...values, ...values) || null;
}

export function listMemberProfiles(chatId) {
  return db.prepare('SELECT * FROM member_profiles WHERE chat_id = ? ORDER BY updated_at DESC').all(chatId);
}

export function getRouletteGame(chatId) {
  return db.prepare(`
    SELECT * FROM roulette_games
    WHERE chat_id = ? AND status IN ('level_pending', 'pending', 'active')
    ORDER BY id DESC
    LIMIT 1
  `).get(chatId) || null;
}

export function createRouletteChallenge({ chatId, challengerId, challengedId, maxRounds = 6, bulletRound = 1, riskLevel = 2 }) {
  db.prepare(`
    UPDATE roulette_games
    SET status = 'cancelled', updated_at = datetime('now'), finished_at = datetime('now')
    WHERE chat_id = ? AND status IN ('level_pending', 'pending', 'active')
  `).run(chatId);
  const result = db.prepare(`
    INSERT INTO roulette_games (chat_id, status, challenger_id, challenged_id, current_shooter_id, current_round, max_rounds, bullet_round, risk_level)
    VALUES (?, 'level_pending', ?, ?, ?, 0, ?, ?, ?)
  `).run(chatId, challengerId, challengedId, challengerId, maxRounds, bulletRound, riskLevel);
  return db.prepare('SELECT * FROM roulette_games WHERE id = ?').get(result.lastInsertRowid);
}

export function setRouletteRiskLevel(chatId, gameId, riskLevel = 2) {
  db.prepare(`
    UPDATE roulette_games
    SET status = 'pending', risk_level = ?, updated_at = datetime('now')
    WHERE chat_id = ? AND id = ? AND status = 'level_pending'
  `).run(riskLevel, chatId, gameId);
  return db.prepare('SELECT * FROM roulette_games WHERE chat_id = ? AND id = ?').get(chatId, gameId) || null;
}

export function acceptRouletteChallenge(chatId, gameId) {
  db.prepare(`
    UPDATE roulette_games
    SET status = 'active', updated_at = datetime('now')
    WHERE chat_id = ? AND id = ? AND status = 'pending'
  `).run(chatId, gameId);
  return db.prepare('SELECT * FROM roulette_games WHERE chat_id = ? AND id = ?').get(chatId, gameId) || null;
}

export function cancelRouletteGame(chatId) {
  db.prepare(`
    UPDATE roulette_games
    SET status = 'cancelled', updated_at = datetime('now'), finished_at = datetime('now')
    WHERE chat_id = ? AND status IN ('level_pending', 'pending', 'active')
  `).run(chatId);
}

export function advanceRouletteRound(chatId, gameId, nextShooterId, currentRound) {
  db.prepare(`
    UPDATE roulette_games
    SET current_shooter_id = ?, current_round = ?, updated_at = datetime('now')
    WHERE chat_id = ? AND id = ? AND status = 'active'
  `).run(nextShooterId, currentRound, chatId, gameId);
  return db.prepare('SELECT * FROM roulette_games WHERE chat_id = ? AND id = ?').get(chatId, gameId) || null;
}

export function finishRouletteGame(chatId, gameId, winnerId, loserId) {
  db.prepare(`
    UPDATE roulette_games
    SET status = 'finished', winner_id = ?, loser_id = ?, updated_at = datetime('now'), finished_at = datetime('now')
    WHERE chat_id = ? AND id = ?
  `).run(winnerId, loserId, chatId, gameId);
}

export function addRouletteShot(chatId, userId, { shots = 1, survived = 0 } = {}) {
  db.prepare(`
    INSERT INTO roulette_stats (chat_id, user_id, shots, survived, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      shots = shots + excluded.shots,
      survived = survived + excluded.survived,
      updated_at = datetime('now')
  `).run(chatId, userId, shots, survived);
}

export function addRouletteResult(chatId, winnerId, loserId) {
  db.prepare(`
    INSERT INTO roulette_stats (chat_id, user_id, wins, medals, updated_at)
    VALUES (?, ?, 1, 1, datetime('now'))
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      wins = wins + 1,
      medals = medals + 1,
      updated_at = datetime('now')
  `).run(chatId, winnerId);
  db.prepare(`
    INSERT INTO roulette_stats (chat_id, user_id, losses, medals, updated_at)
    VALUES (?, ?, 1, 0, datetime('now'))
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      losses = losses + 1,
      medals = MAX(0, medals - 1),
      updated_at = datetime('now')
  `).run(chatId, loserId);
}

export function getRouletteStats(chatId, userId) {
  return db.prepare('SELECT * FROM roulette_stats WHERE chat_id = ? AND user_id = ?').get(chatId, userId) || {
    chat_id: chatId,
    user_id: userId,
    wins: 0,
    losses: 0,
    medals: 0,
    shots: 0,
    survived: 0
  };
}

export function topRouletteStats(chatId, limit = 10) {
  return db.prepare(`
    SELECT * FROM roulette_stats
    WHERE chat_id = ?
    ORDER BY medals DESC, wins DESC, survived DESC
    LIMIT ?
  `).all(chatId, limit);
}

export function createTicket(chatId, userId, reason = '') {
  const result = db.prepare(`
    INSERT INTO tickets (chat_id, user_id, reason)
    VALUES (?, ?, ?)
  `).run(chatId, userId, reason);
  return result.lastInsertRowid;
}

export function listTickets(chatId, status = 'open', limit = 10) {
  return db.prepare(`
    SELECT * FROM tickets
    WHERE chat_id = ? AND status = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(chatId, status, limit);
}

export function closeTicket(chatId, ticketId) {
  db.prepare(`
    UPDATE tickets
    SET status = 'closed', closed_at = datetime('now')
    WHERE chat_id = ? AND id = ?
  `).run(chatId, ticketId);
}

export function setBotRole(userId, role, addedBy = '') {
  db.prepare(`
    INSERT INTO bot_roles (user_id, role, added_by)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, added_by = excluded.added_by
  `).run(userId, role, addedBy);
}

export function removeBotRole(userId) {
  db.prepare('DELETE FROM bot_roles WHERE user_id = ?').run(userId);
}

export function getBotRole(userId) {
  return db.prepare('SELECT role FROM bot_roles WHERE user_id = ?').get(userId)?.role || '';
}

export function listBotRoles() {
  return db.prepare('SELECT * FROM bot_roles ORDER BY role, created_at DESC').all();
}

export function addBlacklist(userId, reason = '', addedBy = '') {
  db.prepare(`
    INSERT INTO blacklist (user_id, reason, added_by)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by
  `).run(userId, reason, addedBy);
}

export function removeBlacklist(userId) {
  db.prepare('DELETE FROM blacklist WHERE user_id = ?').run(userId);
}

export function isBlacklisted(userId) {
  return Boolean(db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(userId));
}

export function listBlacklist() {
  return db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC').all();
}

export function addLinkWhitelist(chatId, userId, addedBy = '') {
  db.prepare(`
    INSERT INTO link_whitelist (chat_id, user_id, added_by)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET added_by = excluded.added_by
  `).run(chatId, userId, addedBy);
}

export function removeLinkWhitelist(chatId, userId) {
  db.prepare('DELETE FROM link_whitelist WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
}

export function isLinkWhitelisted(chatId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM link_whitelist WHERE chat_id = ? AND user_id = ?').get(chatId, userId));
}

export function listLinkWhitelist(chatId) {
  return db.prepare('SELECT * FROM link_whitelist WHERE chat_id = ? ORDER BY created_at DESC').all(chatId);
}

export function addBlockedWord(chatId, word, addedBy = '') {
  db.prepare(`
    INSERT INTO blocked_words (chat_id, word, added_by)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id, word) DO UPDATE SET added_by = excluded.added_by
  `).run(chatId, String(word || '').toLowerCase(), addedBy);
}

export function removeBlockedWord(chatId, word) {
  db.prepare('DELETE FROM blocked_words WHERE chat_id = ? AND word = ?').run(chatId, String(word || '').toLowerCase());
}

export function listBlockedWords(chatId) {
  return db.prepare('SELECT * FROM blocked_words WHERE chat_id = ? ORDER BY word ASC').all(chatId);
}

export function backupDatabase(targetPath) {
  copyFileSync(dbPath, targetPath);
}

export function exportSettingsFile(targetPath) {
  writeFileSync(targetPath, JSON.stringify(exportSettingsObject(), null, 2), 'utf8');
}
