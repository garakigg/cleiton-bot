import 'dotenv/config';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  decryptPollVote,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  generateWAMessageFromContent,
  getKeyAuthor,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import NodeCache from 'node-cache';
import sharp from 'sharp';
import ytdlp from 'yt-dlp-exec';
import ffmpegPath from 'ffmpeg-static';
import { YouTube } from 'youtube-sr';
import ytSearch from 'yt-search';
import { GoogleGenAI } from '@google/genai';
import {
  addBlockedWord,
  addHistory,
  addLinkWhitelist,
  addWarningEvent,
  acceptRouletteChallenge,
  addRouletteResult,
  addRouletteShot,
  clearWarnings,
  cancelRouletteGame,
  createRouletteChallenge,
  advanceRouletteRound,
  findMemberProfile,
  finishRouletteGame,
  getActiveMute,
  getRouletteGame,
  getRouletteStats,
  getSetting,
  getWarningCount,
  isLinkWhitelisted,
  listBlockedWords,
  listLinkWhitelist,
  listMemberProfiles,
  logEvent,
  muteUser,
  recordActivity,
  removeBlockedWord,
  removeLinkWhitelist,
  seedDefaults,
  setRouletteRiskLevel,
  setSetting,
  topRouletteStats,
  topActivity,
  unmuteUser,
  upsertMemberProfile,
  upsertGroup
} from '../db.js';
import { allCatalogCommands, getCategory, getCommandCategory, getMenuCategory } from '../menuCatalog.js';
import { cleitonDefaultSettings, cleitonProfile } from '../lara/profile.js';

const defaults = {
  ...cleitonDefaultSettings(),
  ANTICALL_ENABLED: process.env.ANTICALL_ENABLED || 'true',
  PM_BLOCKER_ENABLED: process.env.PM_BLOCKER_ENABLED || 'false',
  AUTOREAD_ENABLED: process.env.AUTOREAD_ENABLED || 'false',
  AUTOTYPING_ENABLED: process.env.AUTOTYPING_ENABLED || 'true',
  ANTIDELETE_ENABLED: process.env.ANTIDELETE_ENABLED || 'true',
  ANTIFLOOD_ENABLED: process.env.ANTIFLOOD_ENABLED || 'false',
  ANTIFLOOD_LIMIT: process.env.ANTIFLOOD_LIMIT || '6',
  ANTIFLOOD_WINDOW_SECONDS: process.env.ANTIFLOOD_WINDOW_SECONDS || '8',
  ANTILINK_ENABLED: process.env.ANTILINK_ENABLED || 'false',
  ANTIPALAVRA_ENABLED: process.env.ANTIPALAVRA_ENABLED || 'false',
  ANTITRAVA_ENABLED: process.env.ANTITRAVA_ENABLED || 'true',
  ANTITRAVA_MAX_TEXT_LENGTH: process.env.ANTITRAVA_MAX_TEXT_LENGTH || '3500',
  ANTITRAVA_MAX_PAYLOAD_KB: process.env.ANTITRAVA_MAX_PAYLOAD_KB || '220',
  ANTITRAVA_MAX_MEDIA_MB: process.env.ANTITRAVA_MAX_MEDIA_MB || '45',
  ANTITRAVA_MAX_INVISIBLE_CHARS: process.env.ANTITRAVA_MAX_INVISIBLE_CHARS || '180',
  ANTITRAVA_MAX_LINE_BREAKS: process.env.ANTITRAVA_MAX_LINE_BREAKS || '160',
  ANTITRAVA_MAX_MENTIONS: process.env.ANTITRAVA_MAX_MENTIONS || '25',
  ANTITRAVA_MUTE_MINUTES: process.env.ANTITRAVA_MUTE_MINUTES || '10',
  ANTITRAVA_RECOVERY_COOLDOWN_SECONDS: process.env.ANTITRAVA_RECOVERY_COOLDOWN_SECONDS || '90'
};

seedDefaults(defaults);

const sessionDir = join(process.cwd(), 'session-cleiton');
const tempDir = join(process.cwd(), 'temp');
const profilePhotoDir = join(process.cwd(), 'data', 'profile-photos');
const groupExitAudioPath = join(process.cwd(), 'public', 'assets', 'saida-grupo.ogg');
const pesteAudioPath = join(process.cwd(), 'public', 'assets', 'seu-peste.ogg');
const gloriaAudioPath = join(process.cwd(), 'public', 'assets', 'gloria.ogg');
const armandoAudioPath = join(process.cwd(), 'public', 'assets', 'armando.ogg');
const duvidaAudioPath = join(process.cwd(), 'public', 'assets', 'duvida.ogg');
const bloquearAudioPath = join(process.cwd(), 'public', 'assets', 'bloquear.ogg');
const costaAudioPath = join(process.cwd(), 'public', 'assets', 'costa.ogg');
const pacienciaAudioPath = join(process.cwd(), 'public', 'assets', 'paciencia.ogg');
const superboneAudioPath = join(process.cwd(), 'public', 'assets', 'superbone.ogg');
const acheiGracaAudioPath = join(process.cwd(), 'public', 'assets', 'acheigraca.ogg');
const configDir = join(process.cwd(), 'config');
const cleitonConfigPath = join(configDir, 'cleiton-config.json');
const fixedOwnerNumber = '5522981347316';
mkdirSync(sessionDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });
mkdirSync(profilePhotoDir, { recursive: true });
mkdirSync(configDir, { recursive: true });
ensureCleitonConfig();

const msgRetryCounterCache = new NodeCache();
const execFileAsync = promisify(execFile);
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const catalogCommands = new Set(allCatalogCommands());
const knightExtraCommands = new Set([
  'tag', 'staff', 'groupinfo', 'linkgp', 'resetlink'
]);
const deletedStore = new Map();
const recentMessages = new Map();
const sentMessages = new Map();
const contactNames = new Map();
const groupNames = new Map();
const cleitonConversations = new Map();
const cleitonPausedUsers = new Map();
const cleitonReminders = new Map();
const hangmanGames = new Map();
const triviaGames = new Map();
const quizGames = new Map();
const duelQuizGames = new Map();
const lastJokes = new Map();
const recentCouples = new Map();
const menuPolls = new Map();
const roulettePolls = new Map();
const muteNoticeCooldown = new Map();
const floodWindows = new Map();
const autoModNoticeCooldown = new Map();
const pollDecryptFailCooldown = new Map();
const discordInviteCache = new Map();
const antiTravaRecoveryCooldown = new Map();
const groupExitAudioCooldown = new Map();
const groupExitAudioSuppressedUntil = new Map();
let sock;
let pairingTimer = null;
let pairingTimeout = null;
let reconnectTimer = null;
let discordGroupSnapshotTimer = null;
let discordGroupSnapshotDebounceTimer = null;
let starting = false;
let lastRegisteredAt = 0;
let hasAnnouncedRegistration = false;
let startAttemptAt = 0;
let pairingCodeIssuedAt = 0;
let lastPairingAttemptAt = 0;
let unregisteredCloseCount = 0;

function debugLog(event, details = {}) {
  const stamp = new Date().toLocaleString('pt-BR', { hour12: false });
  const data = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' | ');
  console.log(`[${stamp}] [${event}]${data ? ` ${data}` : ''}`);
}

function defaultCleitonConfig() {
  return {
    fixedOwner: fixedOwnerNumber,
    extraOwners: [fixedOwnerNumber],
    discord: {
      enabled: true,
      logsWebhookUrl: process.env.DISCORD_LOGS_WEBHOOK_URL || '',
      messagesWebhookUrl: process.env.DISCORD_MESSAGES_WEBHOOK_URL || '',
      groupSnapshotIntervalMinutes: 60
    }
  };
}

function ensureCleitonConfig() {
  const defaultsConfig = defaultCleitonConfig();
  if (!existsSync(cleitonConfigPath)) {
    writeFileSync(cleitonConfigPath, `${JSON.stringify(defaultsConfig, null, 2)}\n`, 'utf8');
    return;
  }

  try {
    const current = JSON.parse(readFileSync(cleitonConfigPath, 'utf8'));
    const normalized = {
      ...defaultsConfig,
      ...current,
      fixedOwner: fixedOwnerNumber,
      extraOwners: Array.isArray(current.extraOwners) && current.extraOwners.length ? current.extraOwners : defaultsConfig.extraOwners,
      discord: {
        ...defaultsConfig.discord,
        ...(current.discord || {})
      }
    };
    if (JSON.stringify(current) !== JSON.stringify(normalized)) {
      writeFileSync(cleitonConfigPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    }
  } catch {
    writeFileSync(cleitonConfigPath, `${JSON.stringify(defaultsConfig, null, 2)}\n`, 'utf8');
  }
}

function loadCleitonConfig() {
  ensureCleitonConfig();
  try {
    const current = JSON.parse(readFileSync(cleitonConfigPath, 'utf8'));
    const defaultsConfig = defaultCleitonConfig();
    return {
      ...defaultsConfig,
      ...current,
      fixedOwner: fixedOwnerNumber,
      extraOwners: Array.isArray(current.extraOwners) ? current.extraOwners : defaultsConfig.extraOwners,
      discord: {
        ...defaultsConfig.discord,
        ...(current.discord || {})
      }
    };
  } catch {
    return defaultCleitonConfig();
  }
}

function ownerNumbers() {
  const cfg = loadCleitonConfig();
  const numbers = [
    fixedOwnerNumber,
    ...(Array.isArray(cfg.extraOwners) ? cfg.extraOwners : [])
  ].map(onlyDigits).filter(Boolean);
  return [...new Set(numbers)];
}

function shouldLogPollDecryptFail(kind, chatId, pollId, errorMessage) {
  const now = Date.now();
  const key = `${kind}:${chatId}:${pollId}:${errorMessage || 'sem erro'}`;
  const cooldownUntil = pollDecryptFailCooldown.get(key) || 0;
  if (cooldownUntil > now) return false;
  pollDecryptFailCooldown.set(key, now + 30000);
  return true;
}

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};

process.on('unhandledRejection', (error) => {
  console.error('Erro assíncrono no Cleiton Baileys:', error);
  logEvent({ level: 'error', event: 'baileys_unhandled_rejection', message: error?.stack || String(error) });
});

process.on('uncaughtException', (error) => {
  console.error('Erro não tratado no Cleiton Baileys:', error);
  logEvent({ level: 'error', event: 'baileys_uncaught_exception', message: error?.stack || String(error) });
});

setInterval(cleanTemp, 3 * 60 * 60 * 1000);
setInterval(() => {
  const usedMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (usedMb > 450) {
    console.log(`Cleiton passou de ${usedMb}MB. Reinício preventivo estilo Knight.`);
    scheduleReconnect(`memoria alta ${usedMb}MB`, 1000, true);
  }
}, 30 * 1000);

startCleitonBaileys().catch((error) => {
  console.error('Falha ao iniciar Cleiton Baileys:', error?.message || error);
  starting = false;
  scheduleReconnect('falha inicial', 5000);
});

async function startCleitonBaileys() {
  if (starting && Date.now() - startAttemptAt < 30000) {
    debugLog('START_SKIPPED', { reason: 'inicio em andamento', ageMs: Date.now() - startAttemptAt });
    return;
  }
  if (starting) debugLog('START_RECOVER', { reason: 'inicio travado', ageMs: Date.now() - startAttemptAt });
  starting = true;
  startAttemptAt = Date.now();
  debugLog('START', { sessionDir, botNumber: process.env.BOT_NUMBER || process.env.PAIRING_NUMBER || 'sem numero' });
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  closeCurrentSocket('novo start');
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    msgRetryCounterCache,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
    },
    getMessage: async (key) => storedMessageContent(key)
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    if (sock?.authState?.creds?.registered) {
      lastRegisteredAt = Date.now();
      clearPairingTimers();
      unregisteredCloseCount = 0;
      if (!hasAnnouncedRegistration) {
        hasAnnouncedRegistration = true;
        console.log('Pareamento recebido. Cleiton salvou a credencial e esta abrindo a portaria...');
      }
    }
  });
  sock.ev.on('connection.update', handleConnectionUpdate);
  sock.ev.on('messages.upsert', handleMessages);
  sock.ev.on('messages.update', handleMessageUpdates);
  sock.ev.on('contacts.upsert', handleContactsUpdate);
  sock.ev.on('contacts.update', handleContactsUpdate);
  sock.ev.on('group-participants.update', handleGroupParticipantsUpdate);
  sock.ev.on('call', handleCalls);

  await requestPairingLoop(state);
  starting = false;
}

async function requestPairingLoop(state) {
  if (state.creds.registered) return;
  const number = onlyDigits(process.env.PAIRING_NUMBER || process.env.BOT_NUMBER || '');
  if (!number) {
    console.log('\nPAIRING_NUMBER/BOT_NUMBER nao configurado. Use o QR Code ou coloque o numero do BOT no .env.');
    console.log('Exemplo: BOT_NUMBER=5522999999999\n');
    return;
  }

  clearPairingTimers();
  const printPairingCode = async () => {
    if (!sock || sock.authState.creds.registered) {
      clearPairingTimers();
      unregisteredCloseCount = 0;
      return;
    }
    if (Date.now() - lastPairingAttemptAt < 55 * 1000) return;
    try {
      lastPairingAttemptAt = Date.now();
      const rawCode = await sock.requestPairingCode(number);
      const code = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
      pairingCodeIssuedAt = Date.now();
      console.log('\n========================================');
      console.log('Codigo de pareamento do Cleiton:', code);
      console.log('WhatsApp > Aparelhos conectados > Conectar com numero de telefone.');
      console.log('Se expirar, espera: o Cleiton imprime outro automaticamente.');
      console.log('========================================\n');
    } catch (error) {
      const message = error?.message || String(error);
      if (!/closed|not open|connection/i.test(message)) console.error('Nao consegui gerar pairing code agora:', message);
    }
  };

  pairingTimeout = setTimeout(printPairingCode, 2500);
  if (!pairingTimer) pairingTimer = setInterval(printPairingCode, 90 * 1000);
}

async function requestPairingIfNeeded(state) {
  if (state.creds.registered) return;
  const number = onlyDigits(process.env.PAIRING_NUMBER || process.env.BOT_NUMBER || '');
  if (!number) return;
  setTimeout(async () => {
    try {
      const rawCode = await sock.requestPairingCode(number);
      const code = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
      console.log('\nCódigo de pareamento do Cleiton:', code);
      console.log('WhatsApp > Aparelhos conectados > Conectar com número de telefone.\n');
    } catch (error) {
      console.error('Não consegui gerar pairing code. Use o QR se aparecer.', error?.message || error);
    }
  }, 2500);
}

async function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;
  if (qr) {
    if (onlyDigits(process.env.PAIRING_NUMBER || process.env.BOT_NUMBER || '')) {
      debugLog('QR_AVAILABLE', { reason: 'fallback se codigo falhar' });
    }
    console.log('\nQR Code do Cleiton Baileys:\n');
    qrcode.generate(qr, { small: true });
  }
  if (connection === 'open') {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearPairingTimers();
    unregisteredCloseCount = 0;
    starting = false;
    console.log('Cleiton Baileys conectado e pronto.');
    debugLog('CONNECTION_OPEN', {
      userId: sock.user?.id,
      userLid: sock.user?.lid,
      platform: sock.user?.platform
    });
    logEvent({ event: 'baileys_ready', message: 'Motor Knight/Baileys conectado.' });
    void sendDiscordLog('Cleiton conectado', 'Motor Baileys abriu a sessão e está pronto.', [
      { name: 'Bot pareado', value: shortJid(sock.user?.id || sock.user?.jid || 'sem id'), inline: true },
      { name: 'Dono fixo', value: `+${fixedOwnerNumber}`, inline: true },
      { name: 'Sessão', value: sessionDir.slice(-80), inline: false }
    ]).catch((error) => debugLog('DISCORD_READY_LOG_FAIL', { error: error?.message || String(error) }));
    scheduleDiscordGroupSnapshots();
    void sendDiscordGroupsSnapshot('conexao aberta').catch((error) => debugLog('DISCORD_GROUP_SNAPSHOT_FAIL', { error: error?.message || String(error) }));
  }
  if (connection === 'close') {
    const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const reason = DisconnectReason[statusCode] || lastDisconnect?.error?.message || 'desconhecido';
    console.log(`Conexao fechada. Codigo: ${statusCode || 'sem codigo'}. Motivo: ${reason}.`);
    debugLog('CONNECTION_CLOSE', {
      statusCode: statusCode || 'sem codigo',
      reason,
      registered: Boolean(sock?.authState?.creds?.registered),
      lastRegisteredAgeMs: Date.now() - lastRegisteredAt,
      unregisteredCloseCount
    });
    void sendDiscordLog('Conexão fechada', `Código: ${statusCode || 'sem codigo'} | Motivo: ${reason}`, [
      { name: 'Registrado', value: sock?.authState?.creds?.registered ? 'sim' : 'não', inline: true },
      { name: 'Tentativas sem pareamento', value: String(unregisteredCloseCount), inline: true }
    ], 0xf59e0b).catch((error) => debugLog('DISCORD_CLOSE_LOG_FAIL', { error: error?.message || String(error) }));
    if (!sock?.authState?.creds?.registered) unregisteredCloseCount += 1;
    if (!sock?.authState?.creds?.registered) hasAnnouncedRegistration = false;
    if (loggedOut && !sock?.authState?.creds?.registered) {
      console.log('Sessao de pareamento recusada pelo WhatsApp. Cleiton vai limpar e tentar de novo com calma.');
      resetPairingSession();
      scheduleReconnect('sessao nova recusada antes do pareamento', 30000);
      return;
    }
    if (loggedOut && Date.now() - lastRegisteredAt > 20000) {
      console.log('Sessao caiu como loggedOut. Cleiton vai tentar reparar a sessao sem morrer.');
      scheduleReconnect('loggedOut sem encerrar processo', 3000, true);
      return;
    }
    if (!sock?.authState?.creds?.registered) {
      if (unregisteredCloseCount >= 3) {
        console.log('Muitas quedas antes do pareamento. Cleiton vai limpar a tentativa parcial.');
        resetPairingSession();
      }
      scheduleReconnect(`pareamento nao confirmado apos ${reason}`, 30000, true);
      return;
    }
    scheduleReconnect(reason, statusCode === DisconnectReason.timedOut ? 5000 : 8000, true);
    return;
    console.log(loggedOut ? 'Sessão desconectada. Apague session-cleiton para parear de novo.' : 'Conexão caiu. Cleiton vai religar o chat.');
    if (loggedOut && !sock?.authState?.creds?.registered) {
      console.log('Sessão nova ainda não foi pareada. Cleiton vai limpar e gerar uma tentativa nova.');
      resetPairingSession();
      setTimeout(startCleitonBaileys, 3000);
      return;
    }
    if (loggedOut) scheduleReconnect('loggedOut antigo', 3000, true);
    if (!loggedOut) setTimeout(startCleitonBaileys, 3000);
  }
}

function resetPairingSession() {
  try {
    clearPairingTimers();
    pairingCodeIssuedAt = 0;
    lastPairingAttemptAt = 0;
    unregisteredCloseCount = 0;
    if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true });
    mkdirSync(sessionDir, { recursive: true });
  } catch (error) {
    console.error('Nao consegui limpar session-cleiton:', error?.message || error);
  }
}

function pairingCodeIsFresh() {
  return pairingCodeIssuedAt && Date.now() - pairingCodeIssuedAt < 120 * 1000;
}

function clearPairingTimers() {
  if (pairingTimer) clearInterval(pairingTimer);
  if (pairingTimeout) clearTimeout(pairingTimeout);
  pairingTimer = null;
  pairingTimeout = null;
}

function closeCurrentSocket(reason = 'reconnect') {
  if (discordGroupSnapshotTimer) clearInterval(discordGroupSnapshotTimer);
  if (discordGroupSnapshotDebounceTimer) clearTimeout(discordGroupSnapshotDebounceTimer);
  discordGroupSnapshotTimer = null;
  discordGroupSnapshotDebounceTimer = null;
  if (!sock) return;
  try {
    clearPairingTimers();
    debugLog('SOCKET_CLOSE_OLD', { reason });
    sock.ev?.removeAllListeners?.('connection.update');
    sock.ev?.removeAllListeners?.('messages.upsert');
    sock.ev?.removeAllListeners?.('messages.update');
    sock.ev?.removeAllListeners?.('contacts.upsert');
    sock.ev?.removeAllListeners?.('contacts.update');
    sock.ev?.removeAllListeners?.('group-participants.update');
    sock.ev?.removeAllListeners?.('call');
    sock.ws?.close?.();
    sock = null;
  } catch (error) {
    debugLog('SOCKET_CLOSE_OLD_FAIL', { error: error?.message || String(error) });
  }
}

function scheduleReconnect(reason = 'queda', delay = 3000, force = false) {
  if (reconnectTimer) return;
  starting = false;
  clearPairingTimers();
  if (force) closeCurrentSocket(reason);
  console.log(`Auto reconnect em ${Math.round(delay / 1000)}s. Motivo: ${reason}.`);
  debugLog('RECONNECT_SCHEDULED', { reason, delayMs: delay, pairingFresh: Boolean(pairingCodeIsFresh()) });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startCleitonBaileys().catch((error) => {
      console.error('Falha no auto reconnect:', error?.message || error);
      starting = false;
      scheduleReconnect('falha ao reconectar', 5000);
    });
  }, delay);
}

async function handleMessages({ messages, type }) {
  debugLog('MESSAGES_UPSERT', { type, count: messages.length });
  for (const message of messages) {
    try {
      if (!message.message) continue;
      const isPollUpdate = Boolean(message.message?.pollUpdateMessage);
      if (type !== 'notify' && !isPollUpdate) continue;
      rememberRecentMessage(message);
      rememberContactFromMessage(message);
      if (isPollUpdate) {
        debugLog('POLL_MESSAGE_IN', {
          id: message.key.id,
          chat: shortJid(message.key.remoteJid),
          sender: shortJid(senderJid(message)),
          fromMe: Boolean(message.key.fromMe),
          type
        });
        if (await handleRoulettePollMessage(message)) continue;
        if (await handleMenuPollMessage(message)) continue;
        continue;
      }
      debugLog('MESSAGE_IN', {
        id: message.key.id,
        chat: shortJid(message.key.remoteJid),
        sender: shortJid(senderJid(message)),
        fromMe: Boolean(message.key.fromMe),
        text: compactText(extractText(message))
      });
      await logIncomingMessage(message);
      if (type !== 'notify') continue;
      if (message.key.fromMe) continue;
      void sendDiscordMessageLog(message).catch((error) => debugLog('DISCORD_MESSAGE_LOG_FAIL', { error: error?.message || String(error) }));
      if (await handleWelcomeStub(message)) continue;
      await processMessage(message);
    } catch (error) {
      console.error('Erro ao processar mensagem Baileys:', error);
      logEvent({ level: 'error', event: 'baileys_message_error', message: error?.stack || String(error) });
    }
  }
}

function handleContactsUpdate(contacts = []) {
  for (const contact of contacts) rememberContactName(contact.id, contact.notify || contact.name || contact.verifiedName);
  const named = contacts.filter((contact) => contact.notify || contact.name || contact.verifiedName).length;
  if (named) debugLog('CONTACTS_UPDATE', { total: contacts.length, named, cacheSize: contactNames.size });
}

async function processMessage(message) {
  const chatId = message.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  const sender = senderJid(message);
  const body = extractText(message);
  debugLog('PROCESS_MESSAGE', {
    chat: shortJid(chatId),
    group: isGroup,
    sender: shortJid(sender),
    body: compactText(body)
  });

  if (boolSetting('AUTOREAD_ENABLED')) await sock.readMessages([message.key]).catch(() => {});
  if (boolSetting('ANTIDELETE_ENABLED')) rememberMessage(message);
  if (boolSetting('PM_BLOCKER_ENABLED') && !isGroup && !await isOwner(sender)) {
    await sendText(chatId, 'Privado fechado por ordem do Cleiton. Fale comigo no grupo ou aguarde o dono abrir o chat.', message);
    await sock.updateBlockStatus(sender, 'block').catch(() => {});
    return;
  }
  if (isGroup) recordActivity(chatId, sender, Boolean(getMediaMessage(message)));
  if (isGroup) cacheMentionNamesFromMessage(chatId, message);
  let cachedMeta = null;
  if (isGroup) {
    cachedMeta = await withTimeout(sock.groupMetadata(chatId).catch(() => null), 1200, null);
    cacheMemberProfile(chatId, sender, cachedMeta, { name: cleanContactName(message.pushName) });
    if (await enforceMuteIfNeeded(chatId, sender, message, cachedMeta)) return;
    if (await enforceAutoModeration(chatId, sender, message, cachedMeta)) return;
  }

  const rouletteDirect = body.trim().match(/^@?roletarussa(?:\s+(.+))?$/i);
  if (rouletteDirect) return rouletteCommand(chatId, rouletteDirect[1] || '', message);
  if (/^\.(dono|criador|owner)\b/i.test(body.trim())) return ownerCardCommand(chatId, message);

  if (!body.startsWith(prefix())) {
    if (await handleCleitonPausePhrase(chatId, sender, body, message)) return;
    if (shouldCleitonReply(chatId, sender, body)) {
      await sendTyping(chatId);
      await sendText(chatId, await cleitonConversationAnswer(message, body), message);
    }
    return;
  }

  const [rawCommand, ...rest] = body.slice(prefix().length).trim().split(/\s+/);
  const command = rawCommand?.toLowerCase();
  const args = rest.join(' ').trim();
  if (!command) return;
  debugLog('COMMAND', {
    command: `${prefix()}${command}`,
    args: compactText(args),
    chat: shortJid(chatId),
    sender: shortJid(sender),
    mentions: mentionedJids(message).map(shortJid).join(','),
    quotedParticipant: shortJid(message.message?.extendedTextMessage?.contextInfo?.participant || '')
  });
  if (boolSetting('AUTOTYPING_ENABLED')) await sendTyping(chatId);

  if (command === 'menu' || command === 'ajuda' || getMenuCategory(command)) return sendMenuCard(chatId, getMenuCategory(command) || 'menu', message);
  if (command === 'ping' || command === 'alive') return pingCommand(chatId, message);
  if (command === 'regras') return rulesCommand(chatId, message);
  if (command === 'dono' || command === 'criador' || command === 'owner') return ownerCardCommand(chatId, message);
  if (command === 'status' || command === 'statusbot') return sendStatus(chatId, message);
  if (command === 'qr') return qrCommand(chatId, args, message);
  if (command === 'imagem') return imageAiCommand(chatId, args, message);
  if (command === 'rankgrafico') return rankGraphicCommand(chatId, message);
  if (command === 'removebg') return removeBgCommand(chatId, message);
  if (command === 'tapa') return slapCommand(chatId, message);
  if (command === 'voz') return voiceCommand(chatId, args, message);
  if (command === 'lembrete') return reminderCommand(chatId, args, message);
  if (command === 'enquete') return pollCommand(chatId, args, message);
  if (command === 'sorteio') return drawCommand(chatId, args, message);
  if (command === 'topfigurinhas' || command === 'topmidias') return topMediaCommand(chatId, message);
  if (command === 'perfilcard') return profileCardCommand(chatId, args, message);
  if (command === 'casal') return shipImageCommand(chatId, message);
  if (command === 'quiz') return quizCommand(chatId, args, message);
  if (command === 'dueloquiz') return duelQuizCommand(chatId, args, message);
  if (command === 'responder') return quizAnswerCommand(chatId, args, message);
  if (command === 'roletarussa') return rouletteCommand(chatId, args, message);
  if (['wanted', 'wasted', 'preso'].includes(command)) return effectImageCommand(chatId, command, message);
  if (command === 'legendaimg') return captionImageCommand(chatId, args, message);
  if (command === 'aviso') return noticeImageCommand(chatId, args, message);
  if (command === 'traduzir') return translateCommand(chatId, args, message);
  if (['resumir', 'corrigir'].includes(command)) return aiToolCommand(chatId, command, args, message);
  if (command === 'todos' || command === 'tagall' || command === 'hidetag' || command === 'marcar') return tagAll(chatId, args, message);
  if (command === 'perfil' || command === 'profile' || command === 'meustatus') return profileCommand(chatId, args, message);
  if (command === 'syncperfis' || command === 'cacheperfis' || command === 'atualizarperfis') return syncMemberProfilesCommand(chatId, message);
  if (command === 'setnome' || command === 'nomeperfil' || command === 'apelido') return setMemberNameCommand(chatId, args, message);
  if (command === 'nomesemcache' || command === 'semnome') return missingMemberNamesCommand(chatId, message);
  if (command === 'revelar') return revealViewOnceCommand(chatId, message);
  if (command === 'ttp' || command === 'attp') return textStickerCommand(chatId, command, args, message);
  if (command === 'sticker' || command === 'figurinha' || command === 's') return stickerCommand(chatId, message);
  if (command === 'play' || command === 'musica' || command === 'song') return downloadCommand(chatId, args, 'audio', message);
  if (command === 'video' || command === 'playvid') return downloadCommand(chatId, args, 'video', message);
  if (command === 'tkk' || command === 'tiktok') return tiktokCommand(chatId, args, message);
  if (['rank', 'rankativo', 'topmembers', 'ranksemanal', 'rankmensal'].includes(command)) return rankCommand(chatId, message, command);
  if (command === 'relatorio') return reportCommand(chatId, message);
  if (command === 'del' || command === 'delete' || command === 'apagar' || command === 'limpar') return deleteQuotedCommand(chatId, message);
  if (command === 'saiu') return exitAudioCommand(chatId, message);
  if (command === 'peste') return pesteAudioCommand(chatId, message);
  if (command === 'gloria') return gloriaAudioCommand(chatId, message);
  if (command === 'armando') return armandoAudioCommand(chatId, message);
  if (command === 'duvida') return duvidaAudioCommand(chatId, message);
  if (command === 'bloquear') return bloquearAudioCommand(chatId, message);
  if (command === 'costa') return costaAudioCommand(chatId, message);
  if (command === 'paciencia') return pacienciaAudioCommand(chatId, message);
  if (command === 'superbone') return superboneAudioCommand(chatId, message);
  if (command === 'acheigraca') return acheiGracaAudioCommand(chatId, message);
  if (command === 'seradm') return ownerPromoteSelfCommand(chatId, message);
  if (command === 'arquivargp') return archiveGroupCommand(chatId, message);
  if (['kick', 'ban', 'promover', 'promote', 'rebaixar', 'demote', 'fechargp', 'abrirgp', 'opengp', 'closegp'].includes(command)) return groupAdminCommand(chatId, command, message);
  if (command === 'warn' || command === 'adv') return warnCommand(chatId, args, message);
  if (command === 'rmadv' || command === 'deladv' || command === 'limparadv') return clearWarningsCommand(chatId, message);
  if (command === 'listadv') return listWarningsCommand(chatId, message);
  if (command === 'mute') return muteCommand(chatId, args, message);
  if (command === 'desmute' || command === 'unmute') return unmuteCommand(chatId, message);
  if (command === 'antiflood') return autoModerationToggleCommand(chatId, 'ANTIFLOOD_ENABLED', args, message, 'ANTIFLOOD');
  if (command === 'antitrava') return antiTravaCommand(chatId, args, message);
  if (command === 'antilinkgp' || command === 'antlink') return autoModerationToggleCommand(chatId, 'ANTILINK_ENABLED', args, message, 'ANTILINK');
  if (command === 'whitelistlink') return whitelistLinkCommand(chatId, args, message);
  if (command === 'antipalavra') return antiWordCommand(chatId, args, message);
  if (command === 'anticall') return ownerToggle(chatId, 'ANTICALL_ENABLED', args, message);
  if (command === 'pmblocker') return ownerToggle(chatId, 'PM_BLOCKER_ENABLED', args, message);
  if (command === 'autoread') return ownerToggle(chatId, 'AUTOREAD_ENABLED', args, message);
  if (command === 'autotyping') return ownerToggle(chatId, 'AUTOTYPING_ENABLED', args, message);
  if (command === 'x9') return adminToggle(chatId, 'ANTIDELETE_ENABLED', args, message, 'X9');
  if (command === 'antidelete') return ownerToggle(chatId, 'ANTIDELETE_ENABLED', args, message);
  if (command === 'cleartmp') return clearTmpCommand(chatId, message);
  if (command === 'config') return configCommand(chatId, args, message);
  if (command === 'cleiton') return sendText(chatId, await cleitonConversationAnswer(message, args || 'oi cleiton'), message);
  if (command === 'calacleiton' || command === 'cleitonoff' || command === 'pausarcleiton') return pauseCleitonCommand(chatId, sender, message);
  if (command === 'voltacleiton' || command === 'cleitonon' || command === 'ativarcleiton') return resumeCleitonCommand(chatId, sender, message);
  if (knightExtraCommands.has(command)) return knightExtraCommand(chatId, command, args, message);
  if (catalogCommands.has(command)) return catalogFallback(chatId, command, args, message);

  await sendText(chatId, `Comando não encontrado no chat: ${prefix()}${command}. Use ${prefix()}menu.`, message);
}

async function handleMessageUpdates(updates) {
  for (const update of updates) {
    if (update.update?.pollUpdates?.length || update.update?.message?.pollUpdateMessage) {
      debugLog('POLL_UPDATE_SEEN', {
        chat: shortJid(update.key?.remoteJid),
        pollId: update.key?.id || '',
        updates: update.update?.pollUpdates?.length || 0,
        raw: Boolean(update.update?.message?.pollUpdateMessage)
      });
    }
    if (await handleRoulettePollUpdate(update)) continue;
    if (await handleMenuPollUpdate(update)) continue;
  }
  if (!boolSetting('ANTIDELETE_ENABLED')) return;
  for (const update of updates) {
    const revoked = update.update?.messageStubType === 1 || update.update?.message === null;
    if (!revoked) continue;
    const key = messageStoreKey(update.key);
    const old = deletedStore.get(key);
    if (!old?.text) continue;
    const mention = await mentionFor(update.key.remoteJid, old.sender);
    await sendMentionText(update.key.remoteJid, `*X9 do Cleiton*\n\n${mention.text} apagou uma mensagem:\n${old.text}`, [mention.jid]);
  }
}

async function handleGroupParticipantsUpdate(event) {
  try {
    if (!event.id?.endsWith('@g.us')) return;
    debugLog('GROUP_PARTICIPANTS_UPDATE', {
      chat: shortJid(event.id),
      action: event.action,
      author: shortJid(event.author || ''),
      authorPn: shortJid(event.authorPn || ''),
      participants: (event.participants || []).map(participantLogLabel).join(',')
    });
    scheduleDiscordGroupsSnapshotSoon(`alteração de membros: ${event.action || 'sem ação'}`);
    if (['remove', 'leave'].includes(event.action)) {
      if (isVoluntaryGroupExit(event)) {
        await sendGroupExitAudio(event.id);
      } else {
        debugLog('GROUP_EXIT_AUDIO_SKIPPED', { chat: shortJid(event.id), reason: 'remocao por admin' });
      }
      return;
    }
    if (!['add', 'invite', 'join', 'linked_group_join'].includes(event.action)) return;
    await sendWelcomeForParticipants(event.id, event.participants || [], 'participants.update');
  } catch (error) {
    logEvent({ level: 'warn', event: 'baileys_group_update_error', message: error?.message || String(error) });
  }
}

async function sendGroupExitAudio(chatId, options = {}) {
  const { force = false, quoted = null } = options;
  if (!existsSync(groupExitAudioPath)) {
    debugLog('GROUP_EXIT_AUDIO_MISSING', { path: groupExitAudioPath });
    return false;
  }
  const now = Date.now();
  if (!force && (groupExitAudioSuppressedUntil.get(chatId) || 0) > now) {
    debugLog('GROUP_EXIT_AUDIO_SUPPRESSED', { chat: shortJid(chatId) });
    return false;
  }
  if (!force && (groupExitAudioCooldown.get(chatId) || 0) > now) {
    debugLog('GROUP_EXIT_AUDIO_COOLDOWN', { chat: shortJid(chatId) });
    return false;
  }
  groupExitAudioCooldown.set(chatId, now + 12000);
  return sendVoiceAsset(chatId, groupExitAudioPath, quoted, 'groupExitAudio');
}

async function sendVoiceAsset(chatId, audioPath, quoted = null, label = 'voiceAsset') {
  if (!existsSync(audioPath)) {
    debugLog('VOICE_ASSET_MISSING', { label, path: audioPath });
    return false;
  }
  return Boolean(await safeSendMessage(chatId, {
    audio: readFileSync(audioPath),
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true
  }, quoted ? { quoted } : undefined, label));
}

function isVoluntaryGroupExit(event = {}) {
  if (event.action === 'leave') return true;
  if (event.action !== 'remove') return false;
  const authors = [event.author, event.authorPn, event.authorUsername].map(normalizeJid).filter(Boolean);
  const participants = event.participants || [];
  if (!authors.length || !participants.length) return false;
  return participants.every((participant) => {
    const candidates = participantJidCandidates(participant);
    return candidates.some((candidate) => authors.some((author) => sameParticipant(candidate, author)));
  });
}

function participantJidCandidates(participant = '') {
  if (typeof participant === 'string') return [normalizeJid(participant)].filter(Boolean);
  return [
    participant.id,
    participant.lid,
    participant.phoneNumber,
    participant.pn,
    participant.jid
  ].map(normalizeJid).filter(Boolean);
}

function participantLogLabel(participant = '') {
  return shortJid(participantJidCandidates(participant)[0] || String(participant || ''));
}

async function handleWelcomeStub(message) {
  const chatId = message.key.remoteJid;
  if (!chatId?.endsWith('@g.us')) return false;
  const addStubTypes = new Set([27, 31, 71, 140, 141, 151, 161, 166, 168, 172]);
  const stubType = Number(message.messageStubType || 0);
  const params = message.messageStubParameters || [];
  debugLog('STUB_MESSAGE', {
    chat: shortJid(chatId),
    stubType,
    params: params.map(shortJid).join(',')
  });
  if (!addStubTypes.has(stubType)) return false;
  const participants = params.filter((item) => /@/.test(String(item)));
  const targets = participants.length ? participants : [senderJid(message)].filter((jid) => !isBotParticipant(jid));
  if (!targets.length) return false;
  await sendWelcomeForParticipants(chatId, targets, `stub:${stubType}`);
  return true;
}

async function sendWelcomeForParticipants(chatId, participants = [], source = 'unknown') {
  await sleep(1200);
  const uniqueParticipants = [...new Set(participants.map(normalizeJid).filter(Boolean).filter((jid) => !isBotParticipant(jid)))];
  if (!uniqueParticipants.length) {
    debugLog('WELCOME_SKIP', { chat: shortJid(chatId), source, reason: 'sem participantes' });
    return;
  }
  const meta = await sock.groupMetadata(chatId);
  groupNames.set(chatId, meta.subject);
  upsertGroup({ id: { _serialized: chatId }, name: meta.subject, participants: meta.participants, isGroup: true });
  const mentionItems = await Promise.all(uniqueParticipants.map(async (jid) => ({
    target: jid,
    ...await mentionFor(chatId, jid, meta)
  })));
  for (const item of mentionItems) {
    cacheMemberProfile(chatId, item.target, meta, { name: mentionNameText(item.text) });
  }
  debugLog('WELCOME_TARGETS', {
    chat: shortJid(chatId),
    source,
    resolved: mentionItems.map((item) => `${item.text}/${shortJid(item.jid)}/real:${item.real}`).join(',')
  });
  let validMentions = mentionItems
    .filter((item) => item.jid)
    .map((item) => ({
      ...item,
      text: mentionTextForWelcome(item)
    }))
    .filter((item) => item.text);
  if (!validMentions.length) {
    validMentions = uniqueParticipants.map((jid) => ({
      target: jid,
      jid,
      text: formatJid(jid),
      real: true
    }));
  }
  const names = validMentions.length ? validMentions.map((item) => item.text).join(' ') : 'novo integrante';
  const text = [
    `Bem-vindo(a), ${names}!`,
    'Leia as regras e chega junto com respeito. Cleiton ja confirmou sua entrada.'
  ].join('\n');
  const mentionJids = validMentions.map((item) => item.jid);
  debugLog('WELCOME_SEND', {
    chat: shortJid(chatId),
    source,
    names,
    mentions: mentionJids.map(shortJid).join(',')
  });
  for (const item of validMentions) {
    const image = await welcomeCardBuffer(chatId, meta, item).catch((error) => {
      debugLog('WELCOME_CARD_FAIL', { chat: shortJid(chatId), source, target: shortJid(item.target), error: error?.message || String(error) });
      return null;
    });
    if (image) {
      const sent = await safeSendMessage(chatId, { image, caption: text, mentions: mentionJids }, undefined, 'welcomeCard');
      if (!sent) await sendMentionText(chatId, text, mentionJids);
    } else {
      await sendMentionText(chatId, text, mentionJids);
    }
  }
}

async function handleCalls(calls) {
  if (!boolSetting('ANTICALL_ENABLED')) return;
  for (const call of calls) {
    if (call.status !== 'offer') continue;
    await sock.rejectCall(call.id, call.from).catch(() => {});
    await sendText(call.from, 'Chamada recusada automaticamente. O Cleiton responde por mensagem.');
  }
}

async function sendMenu(chatId, key = 'menu', quoted) {
  const category = getCategory(key) || getCategory('menu');
  const lines = [
    `╭┈⊰ 🪳 『 *${getSetting('BOT_DISPLAY_NAME', cleitonProfile.botName)}* 』`,
    `┊ *${category.title}*`,
    '╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯',
    '',
    ...(category.commands || []).map((cmd) => `┊ ${prefix()}${cmd}`),
    '',
    `Dono: ${cleitonProfile.ownerLabel}`,
    `Bot: +${onlyDigits(process.env.BOT_NUMBER || process.env.PAIRING_NUMBER || '') || 'nao definido'}`
  ];
  const imagePath = join(process.cwd(), 'public', 'assets', 'cleiton.jpeg');
  if (existsSync(imagePath)) {
    await sock.sendMessage(chatId, { image: readFileSync(imagePath), caption: lines.join('\n') }, { quoted });
    return;
  }
  await sendText(chatId, lines.join('\n'), quoted);
}

async function sendPollMenu(chatId, key = 'menu', quoted) {
  const category = getCategory(key) || getCategory('menu');
  const commands = [...new Set(category.commands || [])].filter(Boolean);
  if (!commands.length) return sendText(chatId, `${category.title}: sem comandos cadastrados.`, quoted);
  const chunks = chunkArray(commands, 10);
  for (let index = 0; index < chunks.length; index += 1) {
    const sent = await sendMenuPoll(chatId, category, chunks[index], {
      quoted,
      page: index + 1,
      total: chunks.length
    });
    if (!sent) return sendMenu(chatId, key, quoted);
    await sleep(350);
  }
}

async function sendMenuPoll(chatId, category, commands, { quoted, page = 1, total = 1 } = {}) {
  const messageSecret = randomBytes(32);
  const values = commands.map((cmd) => `${prefix()}${cmd}`);
  const pageLabel = total > 1 ? ` (${page}/${total})` : '';
  const pollMessage = await safeSendMessage(chatId, {
    poll: {
      name: `${category.title}${pageLabel}\nSelecione um comando`,
      values,
      selectableCount: 1,
      messageSecret
    }
  }, { quoted }, 'menuPoll');
  if (!pollMessage?.key?.id) return null;
  menuPolls.set(menuPollKey(chatId, pollMessage.key.id), {
    chatId,
    messageSecret,
    options: Object.fromEntries(values.map((value, index) => [value, commands[index]])),
    createdAt: Date.now()
  });
  pruneMenuPolls();
  debugLog('MENU_POLL_OPEN', {
    chat: shortJid(chatId),
    pollId: pollMessage.key.id,
    title: category.title,
    options: commands.join(',')
  });
  return pollMessage;
}

async function sendMenuCard(chatId, key = 'menu', quoted) {
  const category = getCategory(key) || getCategory('menu');
  try {
    const image = await menuCardBuffer(key, category);
    const sent = await safeSendMessage(chatId, { image }, { quoted }, 'menuCard');
    if (sent) return;
  } catch (error) {
    debugLog('MENU_CARD_FAIL', { key, error: error?.message || String(error) });
  }
  await sendText(chatId, menuCardCaption(key, category), quoted);
}

function menuCardCaption(key = 'menu', category = getCategory('menu')) {
  const items = menuCardItems(key, category);
  if (key === 'menu') {
    return [
      '*Cleiton*',
      '',
      'Setores disponiveis:',
      ...items.map((item) => `${prefix()}${item.command} - ${item.label}`),
      '',
      'Mande o comando do setor que quiser abrir.'
    ].join('\n');
  }
  return [
    `*${category.title}*`,
    '',
    ...(category.commands || []).map((cmd) => `${prefix()}${cmd}`),
    '',
    `${prefix()}menu volta para os setores.`
  ].join('\n');
}

function menuCardItems(key = 'menu', category = getCategory('menu')) {
  if (key !== 'menu') return (category.commands || []).map((command) => ({ command, label: command, detail: menuCommandDetail(command) }));
  return (category.commands || []).map((command) => {
    const child = getCategory(command);
    return {
      command,
      label: menuCategoryName(command, child?.title || command),
      detail: menuCategoryDetail(command)
    };
  });
}

function menuCategoryName(key = '', title = '') {
  const names = {
    menuia: 'IA',
    menudown: 'Downloads',
    menufig: 'Figurinhas',
    menuadm: 'Admin',
    menudono: 'Dono',
    menumemb: 'Membros',
    menubrin: 'Brincadeiras',
    ferramentas: 'Ferramentas'
  };
  return names[key] || String(title || key).replace(/^MENU\s+/i, '');
}

function menuCategoryDetail(key = '') {
  const details = {
    menuia: 'conversa, imagem e texto',
    menudown: 'musica, video e TikTok',
    menufig: 'sticker e texto animado',
    menuadm: 'moderacao do grupo',
    menudono: 'configuracoes internas',
    menumemb: 'perfil, rank e regras',
    menubrin: 'jogos e cards',
    ferramentas: 'QR, voz, aviso e utilidades'
  };
  return details[key] || 'setor do bot';
}

function menuCommandDetail(command = '') {
  const details = {
    cleiton: 'conversa com o bot',
    cleitonoff: 'pausa respostas',
    cleitonon: 'ativa respostas',
    imagem: 'imagem com IA',
    resumir: 'resume texto',
    corrigir: 'corrige texto',
    traduzir: 'traduz para PT',
    play: 'baixa audio',
    musica: 'baixa audio',
    video: 'baixa video',
    playvid: 'baixa video',
    tkk: 'TikTok',
    tiktok: 'TikTok',
    sticker: 'cria figurinha',
    figurinha: 'cria figurinha',
    ttp: 'texto sticker',
    attp: 'texto animado',
    perfil: 'ficha do membro',
    perfilcard: 'perfil em card',
    meustatus: 'sua ficha',
    ping: 'status rapido',
    status: 'status do bot',
    regras: 'regras do grupo',
    rank: 'ranking',
    rankativo: 'ranking',
    ranksemanal: 'ranking semanal',
    rankmensal: 'ranking mensal',
    rankgrafico: 'ranking em imagem',
    topfigurinhas: 'top stickers',
    topmidias: 'top midias',
    dono: 'contato do dono',
    criador: 'contato do dono',
    casal: 'sorteio casal',
    quiz: 'quiz solo',
    dueloquiz: 'quiz em duelo',
    roletarussa: 'batalha do tambor',
    antitrava: 'bloqueia travas',
    tapa: 'gif de tapa',
    wanted: 'card wanted',
    preso: 'card preso',
    wasted: 'card wasted'
  };
  return details[command] || 'comando ativo';
}

async function menuCardBuffer(key = 'menu', category = getCategory('menu')) {
  const isMain = key === 'menu';
  const items = menuCardItems(key, category);
  const columns = isMain ? 2 : items.length > 8 ? 3 : 2;
  const rowsPerColumn = Math.ceil(items.length / columns) || 1;
  const colWidth = isMain ? 500 : columns === 3 ? 342 : 500;
  const startX = isMain ? 86 : 78;
  const startY = isMain ? 218 : 216;
  const rowHeight = isMain ? 78 : Math.min(70, Math.max(44, Math.floor(408 / rowsPerColumn)));
  const showSubDetails = !isMain && rowsPerColumn <= 7;
  const colors = ['#22c55e', '#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#fb7185', '#2dd4bf', '#fb923c'];
  const rows = items.map((item, index) => {
    const col = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const x = startX + col * colWidth;
    const y = startY + row * rowHeight;
    const color = colors[index % colors.length];
    if (isMain) {
      return `
        <rect x="${x}" y="${y - 42}" width="${colWidth - 36}" height="64" rx="20" fill="#020617" opacity=".74" stroke="${color}" stroke-opacity=".34" stroke-width="2"/>
        <rect x="${x + 18}" y="${y - 29}" width="42" height="42" rx="21" fill="${color}" opacity=".24"/>
        <text x="${x + 39}" y="${y - 1}" fill="${color}" font-size="21" font-family="Arial" font-weight="900" text-anchor="middle">${index + 1}</text>
        <text x="${x + 80}" y="${y - 14}" fill="#ffffff" font-size="27" font-family="Arial" font-weight="900">${escapeXml(item.label)}</text>
        <text x="${x + 80}" y="${y + 11}" fill="#cbd5e1" font-size="19" font-family="Arial">${escapeXml(item.detail)}</text>
        <text x="${x + colWidth - 58}" y="${y - 1}" fill="${color}" font-size="21" font-family="Arial" font-weight="900" text-anchor="end">${escapeXml(prefix() + item.command)}</text>
      `;
    }
    const commandText = `${prefix()}${item.command}`;
    const detailText = showSubDetails ? item.detail : '';
    const cardHeight = detailText ? 58 : 38;
    const commandSize = menuCommandFontSize(commandText, columns);
    return `
      <rect x="${x}" y="${y - 38}" width="${colWidth - 28}" height="${cardHeight}" rx="18" fill="#020617" opacity=".70" stroke="${color}" stroke-opacity=".20" stroke-width="2"/>
      <text x="${x + 20}" y="${detailText ? y - 12 : y - 13}" fill="${color}" font-size="${commandSize}" font-family="Arial" font-weight="900">${escapeXml(truncateText(commandText, columns === 3 ? 18 : 24))}</text>
      ${detailText ? `<text x="${x + 20}" y="${y + 16}" fill="#cbd5e1" font-size="17" font-family="Arial">${escapeXml(truncateText(detailText, columns === 3 ? 22 : 30))}</text>` : ''}
    `;
  }).join('');
  const title = isMain ? 'MENU PRINCIPAL' : category.title;
  const subtitle = isMain
    ? 'Setores ativos do chat.'
    : `${items.length} comandos ativos.`;
  const svg = Buffer.from(`
<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset=".55" stop-color="#083344"/>
      <stop offset="1" stop-color="#064e3b"/>
    </linearGradient>
    <radialGradient id="glow" cx="82%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#22c55e" stop-opacity=".38"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" rx="42" fill="url(#bg)"/>
  <rect width="1200" height="675" rx="42" fill="url(#glow)"/>
  <rect x="54" y="54" width="1092" height="567" rx="36" fill="#020617" opacity=".57" stroke="#ffffff" stroke-opacity=".12"/>
  <rect x="84" y="88" width="326" height="58" rx="29" fill="#22c55e" opacity=".18"/>
  <text x="247" y="126" fill="#86efac" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">CLEITON</text>
  <text x="430" y="126" fill="#ffffff" font-size="43" font-family="Arial" font-weight="900">${escapeXml(title)}</text>
  <text x="88" y="166" fill="#d1d5db" font-size="24" font-family="Arial">${escapeXml(subtitle)}</text>
  ${rows}
  <text x="1040" y="620" fill="#d1d5db" font-size="22" font-family="Arial" font-style="italic" text-anchor="end">Cleiton</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 102).catch(() => null) : null;
  return sharp(svg).composite(thumb && isMain ? [{ input: thumb, left: 1022, top: 492 }] : []).jpeg({ quality: 92 }).toBuffer();
}

function menuCommandFontSize(text = '', columns = 2) {
  const length = String(text || '').length;
  if (columns >= 3) {
    if (length > 15) return 19;
    if (length > 12) return 21;
    return 23;
  }
  if (length > 17) return 21;
  if (length > 13) return 23;
  return 25;
}

function chunkArray(items = [], size = 10) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function quickReplyButton(label, id) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: label,
      id
    })
  };
}

async function relayInteractive(chatId, interactiveMessage, quoted, label = 'interactive') {
  try {
    const content = generateWAMessageFromContent(chatId, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage
        }
      }
    }, { quoted });
    await sock.relayMessage(chatId, content.message, { messageId: content.key.id });
    debugLog('INTERACTIVE_OK', { label, chat: shortJid(chatId), id: content.key.id });
    return true;
  } catch (error) {
    debugLog('INTERACTIVE_FAIL', { label, chat: shortJid(chatId), error: error?.message || String(error) });
    return false;
  }
}

async function buttonsMenuCommand(chatId, quoted) {
  const items = shortcutMenuItems();
  const image = await shortcutMenuCardBuffer('MENU COM ATALHOS', 'Chat rapido do Cleiton', items);
  const caption = shortcutMenuCaption(items);
  const sent = await safeSendMessage(chatId, { image, caption }, { quoted }, 'compatibleButtonsMenu');
  if (!sent) return sendMenuCard(chatId, 'menu', quoted);
}

function carouselCard(title, body, footer, buttons) {
  return {
    header: proto.Message.InteractiveMessage.Header.fromObject({
      title,
      hasMediaAttachment: false
    }),
    body: proto.Message.InteractiveMessage.Body.fromObject({ text: body }),
    footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: footer }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
      messageParamsJson: '',
      buttons
    })
  };
}

async function carouselMenuCommand(chatId, quoted) {
  return compatibleCarouselMenuCommand(chatId, quoted);
  const cards = [
    carouselCard('MEMBROS', 'Perfil, ranking, regras e status do grupo.', 'Cleiton', [
      quickReplyButton('Abrir membros', `${prefix()}menumemb`),
      quickReplyButton('Ver rank', `${prefix()}rank`)
    ]),
    carouselCard('ADMIN', 'Moderação, mute, advertências e marcações.', 'Cleiton', [
      quickReplyButton('Abrir admin', `${prefix()}menuadm`),
      quickReplyButton('Status', `${prefix()}status`)
    ]),
    carouselCard('BRINCADEIRAS', 'Casal, roleta, piada e jogos do chat.', 'Cleiton', [
      quickReplyButton('Abrir brincadeiras', `${prefix()}menubrin`),
      quickReplyButton('Roleta', `${prefix()}roletarussa placar`)
    ]),
    carouselCard('DOWNLOADS', 'Música, vídeo e TikTok.', 'Cleiton', [
      quickReplyButton('Abrir downloads', `${prefix()}menudown`),
      quickReplyButton('Play', `${prefix()}play`)
    ]),
    carouselCard('FERRAMENTAS', 'Figurinhas, QR, voz, aviso e imagem.', 'Cleiton', [
      quickReplyButton('Abrir ferramentas', `${prefix()}ferramentas`),
      quickReplyButton('Figurinhas', `${prefix()}menufig`)
    ])
  ];
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.fromObject({
      text: 'Menu em carrossel da Cleiton.'
    }),
    footer: proto.Message.InteractiveMessage.Footer.fromObject({
      text: 'Chat aberto.'
    }),
    header: proto.Message.InteractiveMessage.Header.fromObject({
      hasMediaAttachment: false
    }),
    carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards })
  });
  const ok = await relayInteractive(chatId, interactiveMessage, quoted, 'carouselMenu');
  if (!ok) return sendMenuCard(chatId, 'menu', quoted);
}

async function compatibleCarouselMenuCommand(chatId, quoted) {
  const items = carouselMenuItems();
  const image = await carouselStyleMenuCardBuffer(items);
  const caption = shortcutMenuCaption(items);
  const sent = await safeSendMessage(chatId, { image, caption }, { quoted }, 'compatibleCarouselMenu');
  if (!sent) return sendMenuCard(chatId, 'menu', quoted);
}

function shortcutMenuItems() {
  return [
    { label: 'Menu geral', command: 'menu', detail: 'Todos os setores' },
    { label: 'Brincadeiras', command: 'menubrin', detail: 'Jogos e zoeira' },
    { label: 'Downloads', command: 'menudown', detail: 'Musica, video e TikTok' },
    { label: 'Admin', command: 'menuadm', detail: 'Moderacao do grupo' },
    { label: 'Rank', command: 'rank', detail: 'Top membros' }
  ];
}

function carouselMenuItems() {
  return [
    { label: 'Membros', command: 'menumemb', detail: 'Perfil, rank e regras' },
    { label: 'Admin', command: 'menuadm', detail: 'Mute, warn e grupo' },
    { label: 'Brincadeiras', command: 'menubrin', detail: 'Casal, roleta e piada' },
    { label: 'Downloads', command: 'menudown', detail: 'Audio, video e TikTok' },
    { label: 'Ferramentas', command: 'ferramentas', detail: 'Figurinha, QR e voz' }
  ];
}

function shortcutMenuCaption(items = []) {
  return [
    '*Cleiton*',
    '',
    ...items.map((item, index) => `${index + 1}. ${prefix()}${item.command} - ${item.label}`),
    '',
    'Mande o comando da opcao que quiser abrir.'
  ].join('\n');
}

async function sendStatus(chatId, quoted) {
  const usedMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const image = await statusCardBuffer([
    ['Motor', 'Baileys'],
    ['Uptime', formatDuration(process.uptime())],
    ['Memoria RSS', `${usedMb} MB`],
    ['Heap', `${heapMb} MB`],
    ['Anticall', onOff('ANTICALL_ENABLED')],
    ['Autotyping', onOff('AUTOTYPING_ENABLED')],
    ['X9', onOff('ANTIDELETE_ENABLED')]
  ]);
  await safeSendMessage(chatId, { image, caption: 'Status do Cleiton registrado.' }, { quoted }, 'statusCard');
}

async function rulesCommand(chatId, quoted) {
  const image = await rulesCardBuffer(rulesText());
  await safeSendMessage(chatId, { image, caption: '*Regras confirmadas pelo Cleiton*' }, { quoted }, 'rulesCard');
}

async function ownerCardCommand(chatId, quoted) {
  const image = await ownerCardBuffer();
  const ownerJid = `${cleitonProfile.ownerNumber}@s.whatsapp.net`;
  const caption = [
    '*Meu Dono*',
    '',
    '*Criador Ofc do Bot*',
    `Dono: @${cleitonProfile.ownerNumber}`,
    `Numero: ${cleitonProfile.ownerLabel}`,
    '',
    'Cleiton.'
  ].join('\n');
  await safeSendMessage(chatId, { image, caption, mentions: [ownerJid] }, { quoted }, 'ownerCard');
}

async function pingCommand(chatId, quoted) {
  const started = performance.now();
  const sentAt = Number(quoted?.messageTimestamp || 0) * 1000;
  const messageLag = sentAt ? Math.max(0, Date.now() - sentAt) : 0;
  const usedMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const latency = Math.max(1, Math.round(performance.now() - started));
  const image = await pingCardBuffer({
    latency,
    messageLag,
    uptime: formatDuration(process.uptime()),
    usedMb,
    heapMb
  });
  await safeSendMessage(chatId, {
    image,
    caption: `Ping do Cleiton: ${latency} ms`
  }, { quoted }, 'pingCard');
}

async function qrCommand(chatId, args, quoted) {
  if (!args) return sendText(chatId, `Use assim: ${prefix()}qr texto, link, pix ou wifi.`, quoted);
  const urls = [
    `https://qrgenapp.com/api/qr?data=${encodeURIComponent(args)}&size=900&format=png`,
    `https://quickchart.io/qr?text=${encodeURIComponent(args)}&size=900&margin=2`
  ];
  for (const url of urls) {
    const image = await fetchBuffer(url).catch(() => null);
    if (image) {
      return safeSendMessage(chatId, { image, caption: 'QR Code registrado pelo Cleiton.' }, { quoted }, 'qrCode');
    }
  }
  return sendText(chatId, 'Nao consegui gerar esse QR agora. A impressora do Cleiton engasgou.', quoted);
}

async function avatarCommand(chatId, args, quoted) {
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const target = targetJid(quoted);
  const participant = findParticipant(meta, target || senderJid(quoted));
  const typedName = mentionNameFromMessage(quoted, target || senderJid(quoted));
  const seed = args?.replace(/@\S+/g, '').trim()
    || typedName
    || participantName(participant, target || senderJid(quoted))
    || quoted.pushName
    || onlyDigits(target || senderJid(quoted))
    || 'Cleiton';
  const image = await diceBearAvatarBuffer(seed);
  return safeSendMessage(chatId, { image, caption: `Avatar gerado para *${seed}*.` }, { quoted }, 'diceBearAvatar');
}

async function imageAiCommand(chatId, args, quoted) {
  if (!args) return sendText(chatId, `Use assim: ${prefix()}imagem Cleiton em um chat futurista`, quoted);
  await sendText(chatId, 'Cleiton abriu a prancheta e foi desenhar isso.', quoted);
  const prompt = `${args}. estilo limpo, imagem para WhatsApp, sem texto escrito`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&nologo=true&safe=true`;
  const image = await fetchBuffer(url, 45000).catch((error) => {
    debugLog('POLLINATIONS_FAIL', { error: error?.message || String(error) });
    return null;
  });
  if (!image) return sendText(chatId, 'Nao consegui gerar a imagem agora. O lapis do Cleiton pediu intervalo.', quoted);
  return safeSendMessage(chatId, { image, caption: 'Imagem pronta.' }, { quoted }, 'pollinationsImage');
}

async function rankGraphicCommand(chatId, quoted) {
  const rows = topActivity(chatId, 6);
  if (!rows.length) return sendText(chatId, 'Ainda nao tem dados para desenhar o ranking.', quoted);
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const items = rows.map((row, index) => {
    const participant = findParticipant(meta, row.user_id);
    const mention = mentionFromParticipant(participant, row.user_id);
    return {
      label: rankDisplayName(mention, participant, row.user_id, index),
      value: activityCount(row)
    };
  });
  const image = await rankGraphicBuffer(items, meta?.subject || 'Grupo');
  return safeSendMessage(chatId, { image, caption: 'Ranking em grafico, confirmado pelo Cleiton.' }, { quoted }, 'rankGraphic');
}

async function removeBgCommand(chatId, quoted) {
  const key = process.env.REMOVEBG_API_KEY || process.env.REMOVE_BG_API_KEY;
  if (!key) return sendText(chatId, 'Para remover fundo, coloque REMOVEBG_API_KEY no .env. O plano gratis da remove.bg libera algumas chamadas por mes.', quoted);
  const mediaMessage = getMediaMessage(quoted);
  if (!mediaMessage) return sendText(chatId, `Responda uma imagem com ${prefix()}removebg.`, quoted);
  const input = await downloadMedia(mediaMessage);
  const form = new FormData();
  form.append('image_file', new Blob([input]), 'imagem.png');
  form.append('size', 'preview');
  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': key },
    body: form
  }).catch(() => null);
  if (!response?.ok) return sendText(chatId, 'A remove.bg recusou o pedido agora. Confere a chave ou a cota gratis.', quoted);
  const image = Buffer.from(await response.arrayBuffer());
  return safeSendMessage(chatId, { image, caption: 'Fundo removido. Cleiton passou a vassoura.' }, { quoted }, 'removeBg');
}

async function memeCommand(chatId, args, quoted) {
  if (!args) return sendText(chatId, `Use assim: ${prefix()}meme texto de cima | texto de baixo`, quoted);
  const [top, bottom = ''] = args.split('|').map((item) => item.trim());
  const image = await memeBuffer(top, bottom || 'Cleiton fez.');
  return safeSendMessage(chatId, { image, caption: 'Meme registrado pelo Cleiton.' }, { quoted }, 'localMeme');
}

async function slapCommand(chatId, quoted) {
  if (!chatId.endsWith('@g.us')) return sendText(chatId, 'Tapa protocolar so funciona em grupo.', quoted);
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, `Use assim: ${prefix()}tapa @usuario`, quoted);
  const meta = await sock.groupMetadata(chatId).catch(() => null);
  const actor = senderJid(quoted);
  const actorMention = await mentionFor(chatId, actor, meta);
  const targetMention = await mentionFor(chatId, target, meta);
  if (sameParticipant(actor, target)) return sendText(chatId, 'Auto-tapa nao vale. Escolhe outra pessoa.', quoted);
  const gifPath = join(process.cwd(), 'public', 'assets', 'tapa.mp4');
  if (!existsSync(gifPath)) return sendText(chatId, 'O GIF do tapa nao foi encontrado.', quoted);
  return safeSendMessage(chatId, {
    video: readFileSync(gifPath),
    gifPlayback: true,
    mimetype: 'video/mp4',
    caption: `${actorMention.text} deu um tapa em ${targetMention.text}.`,
    mentions: [actorMention.jid, targetMention.jid].filter(Boolean)
  }, { quoted }, 'slapGif');
}

async function jokeCommand(chatId, quoted) {
  const url = 'https://v2.jokeapi.dev/joke/Any?lang=pt&blacklistFlags=nsfw,religious,political,racist,sexist,explicit&safe-mode';
  const local = nextCleitonJoke(chatId);
  if (Math.random() < 0.65) return sendText(chatId, `*Piada registrada pelo Cleiton*\n\n${local}`, quoted);
  try {
    const joke = await fetchJson(url, 12000);
    if (joke?.error) throw new Error(joke.message || 'JokeAPI retornou erro');
    const text = joke.type === 'twopart'
      ? `${joke.setup}\n\n${joke.delivery}`
      : joke.joke;
    if (!text) throw new Error('Piada vazia');
    return sendText(chatId, `*Piada registrada pelo Cleiton*\n\n${text}`, quoted);
  } catch (error) {
    debugLog('JOKE_API_FAIL', { error: error?.message || String(error) });
    return sendText(chatId, `*Piada registrada pelo Cleiton*\n\n${local}`, quoted);
  }
}

async function voiceCommand(chatId, args, quoted) {
  const text = args?.trim();
  if (!text) return sendText(chatId, `Use assim: ${prefix()}voz texto que o Cleiton vai falar`, quoted);
  if (text.length > 240) return sendText(chatId, 'Segura a ata, chefe. Para voz, manda ate 240 caracteres.', quoted);

  const stamp = Date.now();
  const wav = join(tempDir, `cleiton-voz-${stamp}.wav`);
  const mp3 = join(tempDir, `cleiton-voz-${stamp}.mp3`);
  try {
    await synthesizeWindowsSpeech(text, wav);
    await execFileAsync(ffmpegPath, ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '5', mp3], { windowsHide: true, timeout: 45000 });
    await safeSendMessage(chatId, {
      audio: readFileSync(mp3),
      mimetype: 'audio/mpeg',
      ptt: false
    }, { quoted }, 'voiceTts');
  } catch (error) {
    debugLog('VOICE_FAIL', { error: error?.message || String(error) });
    await sendText(chatId, 'A voz do Cleiton engasgou no Windows agora. Confere se o PC tem voz instalada em portugues.', quoted);
  } finally {
    safeUnlink(wav);
    safeUnlink(mp3);
  }
}

async function testWelcomeCommand(chatId, quoted) {
  if (!chatId.endsWith('@g.us')) return sendText(chatId, 'Esse teste precisa ser feito dentro de um grupo.', quoted);
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted) || senderJid(quoted);
  const item = {
    target,
    ...await mentionFor(chatId, target, meta)
  };
  item.text = mentionTextForWelcome(item) || formatJid(item.jid || target);
  const text = [
    `Bem-vindo(a), ${item.text}!`,
    'Leia as regras e chega junto com respeito. Cleiton ja confirmou sua entrada.'
  ].join('\n');
  const image = await welcomeCardBuffer(chatId, meta, item).catch((error) => {
    debugLog('WELCOME_TEST_CARD_FAIL', { chat: shortJid(chatId), target: shortJid(target), error: error?.message || String(error) });
    return null;
  });
  const mentions = item.jid ? [item.jid] : [];
  if (image) {
    const sent = await safeSendMessage(chatId, { image, caption: text, mentions }, { quoted }, 'welcomeCardTest');
    if (sent) return;
  }
  return sendMentionText(chatId, text, mentions, quoted);
}

async function manualWelcomeCommand(chatId, quoted) {
  if (!chatId.endsWith('@g.us')) return sendText(chatId, 'Esse comando so funciona em grupo.', quoted);
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted) || senderJid(quoted);
  const item = { target, ...await mentionFor(chatId, target, meta) };
  item.text = mentionTextForWelcome(item) || formatJid(item.jid || target);
  const image = await welcomeCardBuffer(chatId, meta, item);
  return safeSendMessage(chatId, {
    image,
    caption: `Bem-vindo(a), ${item.text}!\nLeia as regras e chega junto com respeito.`,
    mentions: item.jid ? [item.jid] : []
  }, { quoted }, 'manualWelcome');
}

async function reminderCommand(chatId, args, quoted) {
  const match = args.match(/^(\d+)\s*(s|seg|m|min|h|hora|horas|d|dia|dias)\s+(.+)/i);
  if (!match) return sendText(chatId, `Use assim: ${prefix()}lembrete 10m beber agua`, quoted);
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const text = match[3].trim();
  const mult = unit.startsWith('s') ? 1000 : unit.startsWith('h') ? 3600000 : unit.startsWith('d') ? 86400000 : 60000;
  const delay = Math.min(amount * mult, 7 * 86400000);
  const id = `${chatId}:${senderJid(quoted)}:${Date.now()}`;
  const timer = setTimeout(async () => {
    cleitonReminders.delete(id);
    await sendMentionText(chatId, `*Lembrete do Cleiton*\n\n${formatJid(senderJid(quoted))}, voce pediu: ${text}`, [senderJid(quoted)]);
  }, delay);
  cleitonReminders.set(id, timer);
  return sendText(chatId, `Lembrete registrado. Cleiton te chama em ${formatDuration(delay / 1000)}.`, quoted);
}

async function pollCommand(chatId, args, quoted) {
  const parts = args.split('|').map((item) => item.trim()).filter(Boolean);
  if (parts.length < 3) return sendText(chatId, `Use assim: ${prefix()}enquete pergunta | opcao 1 | opcao 2`, quoted);
  const [question, ...options] = parts.slice(0, 7);
  const image = await pollImageBuffer(question, options);
  const caption = [`*Enquete do Cleiton*`, question, '', ...options.map((option, i) => `${i + 1}. ${option}`), '', '_Responda com o numero da opcao._'].join('\n');
  return safeSendMessage(chatId, { image, caption }, { quoted }, 'pollImage');
}

async function drawCommand(chatId, args, quoted) {
  const clean = args.trim();
  let result = '';
  if (/^\d+\s*-\s*\d+$/.test(clean)) {
    const [a, b] = clean.split('-').map((n) => Number(n.trim()));
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    result = String(min + Math.floor(Math.random() * (max - min + 1)));
  } else {
    const options = clean.split(/[\n,|]+/).map((item) => item.trim()).filter(Boolean);
    if (!options.length) return sendText(chatId, `Use assim: ${prefix()}sortear 1-100 ou ${prefix()}sorteio Ana | Bia | Caio`, quoted);
    result = randomItem(options);
  }
  const image = await noticeImageBuffer('SORTEIO DO CLEITON', result, 'Resultado confirmado sem recurso.');
  return safeSendMessage(chatId, { image, caption: `Sorteio registrado: *${result}*` }, { quoted }, 'drawImage');
}

async function phraseCommand(chatId, quoted) {
  return sendText(chatId, randomItem([
    'Quem respeita regra deixa o grupo leve.',
    'Humildade no grupo e igual senha de atendimento: todo mundo precisa pegar.',
    'Cleiton avisa: pressa e boa, flood e processo administrativo.',
    'A tropa cresce quando a resenha vem com respeito.'
  ]), quoted);
}

async function topMediaCommand(chatId, quoted) {
  const rows = topActivity(chatId, 5).filter((row) => Number(row.media || 0) > 0);
  if (!rows.length) return sendText(chatId, 'Ainda nao tem midia suficiente para ranking.', quoted);
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const items = rows.map((row, index) => {
    const participant = findParticipant(meta, row.user_id);
    const mention = mentionFromParticipant(participant, row.user_id);
    return {
      label: rankDisplayName(mention, participant, row.user_id, index),
      value: Number(row.media || 0)
    };
  });
  const image = await rankGraphicBuffer(items, `${meta?.subject || 'Grupo'} - midias`);
  return safeSendMessage(chatId, { image, caption: 'Top midias do Cleiton.' }, { quoted }, 'topMediaCard');
}

async function profileCardCommand(chatId, args, quoted) {
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const target = resolveProfileTarget(meta, args, quoted);
  const participant = findParticipant(meta, target);
  const mention = await mentionFor(chatId, target, meta);
  const image = await profileCardBuffer(chatId, meta, target, participant, mention, quoted);
  return safeSendMessage(chatId, { image, caption: `Ficha visual de ${mention.text}.`, mentions: mention.jid ? [mention.jid] : [] }, { quoted }, 'profileCard');
}

async function syncMemberProfilesCommand(chatId, quoted) {
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const participants = (meta.participants || []).filter((participant) => !isBotParticipant(participant.id));
  if (!participants.length) return sendText(chatId, 'Nao achei membros para cachear.', quoted);

  await sendText(chatId, `Cleiton abriu o arquivo morto. Vou cachear ${participants.length} perfil(is): nome, ID e foto quando o WhatsApp liberar.`, quoted);
  let names = 0;
  let photos = 0;
  let failures = 0;

  for (const participant of participants) {
    try {
      const target = normalizeJid(participant.id || participant.phoneNumber || participant.lid);
      const mappedPn = await pnForJid(participant.phoneNumber || participant.id || participant.lid || target).catch(() => null);
      if (mappedPn || participant.phoneNumber) {
        await sock.onWhatsApp(onlyDigits(mappedPn || participant.phoneNumber)).catch(() => null);
      }
      const name = cleanCardName(participantName(participant, target))
        || cleanCardName(contactNameFor(target, mappedPn, participant.phoneNumber, participant.id, participant.lid));
      let photoPath = '';
      const image = await withTimeout(profileImageBuffer(mappedPn, participant.phoneNumber, target, participant.id, participant.lid), 4500, null).catch(() => null);
      if (image) {
        photoPath = saveProfilePhoto(chatId, mappedPn || participant.phoneNumber || target, image);
        photos += 1;
      }
      if (name) names += 1;
      cacheMemberProfile(chatId, target, meta, { name, photoPath, mappedPn });
      await sleep(250);
    } catch (error) {
      failures += 1;
      debugLog('PROFILE_SYNC_ITEM_FAIL', { chat: shortJid(chatId), error: error?.message || String(error) });
    }
  }

  return sendText(chatId, [
    '*Cache de perfis atualizado*',
    '',
    `Membros varridos: ${participants.length}`,
    `Nomes salvos: ${names}`,
    `Fotos salvas: ${photos}`,
    `Falhas: ${failures}`,
    '',
    'Agora o !casal e os cards vao consultar esse banco antes de improvisar.'
  ].join('\n'), quoted);
}

async function setMemberNameCommand(chatId, args, quoted) {
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, `Marque ou responda alguem. Ex: ${prefix()}setnome @pessoa Kayron`, quoted);
  const mentions = mentionedJids(quoted);
  let name = args.trim();
  if (mentions.length) name = name.replace(/^@\S+\s*/u, '').trim();
  name = cleanCardName(name);
  if (!name) return sendText(chatId, `Faltou o nome. Use: ${prefix()}setnome @pessoa Nome Bonito`, quoted);

  const participant = findParticipant(meta, target);
  const mappedPn = await pnForJid(participant?.phoneNumber || participant?.id || participant?.lid || target).catch(() => null);
  cacheMemberProfile(chatId, target, meta, { name, mappedPn });
  rememberContactName(target, name);
  if (mappedPn) rememberContactName(mappedPn, name);

  const mention = await mentionFor(chatId, target, meta);
  return sendMentionText(chatId, `Nome salvo: ${mention.text} agora aparece como *${name}*.`, mention.jid ? [mention.jid] : [], quoted);
}

async function missingMemberNamesCommand(chatId, quoted) {
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const rows = (meta.participants || [])
    .filter((participant) => !isBotParticipant(participant.id))
    .map((participant) => {
      const target = normalizeJid(participant.id || participant.phoneNumber || participant.lid);
      const cached = findMemberProfile(chatId, target, participant.phoneNumber, participant.id, participant.lid);
      const name = cleanCardName(cached?.name || participantName(participant, target) || contactNameFor(target, participant.phoneNumber, participant.id, participant.lid));
      return name ? '' : `- ${formatJid(participant.phoneNumber || participant.id || target)}`;
    })
    .filter(Boolean)
    .slice(0, 30);
  if (!rows.length) return sendText(chatId, 'Todo mundo que o Cleiton conhece ja tem nome salvo no cache.', quoted);
  return sendText(chatId, [
    '*Membros sem nome salvo*',
    '',
    ...rows,
    '',
    `Use ${prefix()}setnome @pessoa Nome para corrigir.`
  ].join('\n'), quoted);
}

async function shipImageCommand(chatId, quoted) {
  const mentions = mentionedJids(quoted).filter((jid) => !isBotParticipant(jid));
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const randomMode = !mentions.length && chatId.endsWith('@g.us');
  if (!mentions.length && chatId.endsWith('@g.us')) {
    const picked = randomCoupleParticipants(meta, senderJid(quoted));
    if (picked.length < 2) return sendText(chatId, 'Nao achei gente suficiente para formar casal no chat.', quoted);
    mentions.push(...picked);
  }
  const sender = senderJid(quoted);
  const a = mentions[0] || sender;
  const b = mentions[1] || (mentions[0] ? sender : targetJid(quoted)) || sender;
  const leftMention = await mentionFor(chatId, a, meta);
  const rightMention = await mentionFor(chatId, b, meta);
  const left = { ...leftMention, target: a, avatarTarget: leftMention.jid || a, label: coupleMemberName(meta, a, quoted, leftMention, 1) };
  const right = { ...rightMention, target: b, avatarTarget: rightMention.jid || b, label: coupleMemberName(meta, b, quoted, rightMention, 2) };
  const percent = couplePercent(a, b);
  debugLog('SHIP_PAIR', {
    chat: shortJid(chatId),
    leftMention: shortJid(left.jid),
    leftAvatar: shortJid(left.avatarTarget),
    rightMention: shortJid(right.jid),
    rightAvatar: shortJid(right.avatarTarget),
    percent
  });
  const image = await shipCardBuffer(chatId, meta, left, right, percent);
  const mentionList = [left.jid, right.jid].filter(Boolean);
  const leftText = left.text?.startsWith('@') ? left.text : '@par1';
  const rightText = right.text?.startsWith('@') ? right.text : '@par2';
  const caption = [
    `*Casal do Cleiton*`,
    '',
    `${leftText} + ${rightText}`,
    `Compatibilidade: *${percent}%*`
  ].join('\n');
  return safeSendMessage(chatId, { image, caption, mentions: mentionList }, { quoted }, 'shipImage');
}

async function rouletteCommand(chatId, args, quoted) {
  const meta = await requireRouletteGroup(chatId, quoted);
  if (!meta) return;
  const sender = roulettePlayerId(meta, senderJid(quoted));
  const cleanArgs = String(args || '').trim();
  const action = cleanArgs.toLowerCase();
  const actionKey = action.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');

  if (['tutorial', 'ajuda', 'help', 'comojogar'].includes(actionKey)) return rouletteTutorialCommand(chatId, quoted);
  if (['placar', 'rank', 'medalhas'].includes(action)) return rouletteScoreCommand(chatId, meta, quoted);
  if (['cancelar', 'sair', 'parar'].includes(action)) return rouletteCancelCommand(chatId, meta, quoted);

  const game = getRouletteGame(chatId);
  if (game?.status === 'level_pending') {
    const levelChoice = rouletteLevelChoice(actionKey);
    if (levelChoice) return rouletteSelectLevelCommand(chatId, meta, quoted, game, sender, levelChoice);
    return rouletteLevelPendingCommand(chatId, meta, quoted, game, sender);
  }
  if (game?.status === 'pending') {
    if (['aceitar', 'aceito', 'sim', 'start', 'iniciar'].includes(actionKey)) return rouletteAcceptCommand(chatId, meta, quoted, game, sender);
    if (['recusar', 'recuso', 'negar', 'nao'].includes(actionKey)) return rouletteRefuseCommand(chatId, meta, quoted, game, sender);
    return roulettePendingCommand(chatId, meta, quoted, game, sender);
  }
  if (['aceitar', 'aceito', 'sim', 'start', 'iniciar', 'recusar', 'recuso', 'negar', 'nao'].includes(action) || actionKey === 'nao') {
    return sendText(chatId, 'Nao tem desafio de roleta aguardando resposta.', quoted);
  }
  if (['recusar', 'recuso', 'negar', 'nao', 'não'].includes(action)) {
    return rouletteRefuseCommand(chatId, meta, quoted, game, sender);
  }
  if (game?.status === 'pending') return roulettePendingCommand(chatId, meta, quoted, game, sender);
  if (game?.status === 'active') return rouletteShotCommand(chatId, meta, quoted, game, sender);

  const targetRaw = targetJid(quoted);
  if (!targetRaw) {
    return sendText(chatId, [
      `Use ${prefix()}roletarussa @pessoa para abrir desafio.`,
      `Use ${prefix()}roletarussa placar para ver medalhas.`
    ].join('\n'), quoted);
  }

  const challenged = roulettePlayerId(meta, targetRaw);
  if (!challenged || !findParticipant(meta, challenged)) return sendText(chatId, 'Nao achei esse jogador no grupo.', quoted);
  if (sameParticipant(sender, challenged)) return sendText(chatId, 'Roleta solo nao passa na portaria do Cleiton.', quoted);
  if (isBotParticipant(challenged)) return sendText(chatId, 'Cleiton nao entra no tambor dessa brincadeira.', quoted);

  const maxRounds = 6;
  const bulletRound = randomInt(1, maxRounds + 1);
  const created = createRouletteChallenge({ chatId, challengerId: sender, challengedId: challenged, maxRounds, bulletRound });
  debugLog('ROULETTE_CHALLENGE', {
    chat: shortJid(chatId),
    challenger: shortJid(sender),
    challenged: shortJid(challenged),
    bulletRound
  });
  const challengerMention = await mentionFor(chatId, sender, meta);
  const challengedMention = await mentionFor(chatId, challenged, meta);
  return sendRouletteLevelPoll(chatId, quoted, created, challengerMention, challengedMention, meta);
}

function rouletteLevelChoice(actionKey = '') {
  if (['nivel1', 'n1', 'level1', '1', 'leve', 'medalha', 'medalhas'].includes(actionKey)) return 1;
  if (['nivel2', 'n2', 'level2', '2', 'ban', 'banido', 'banir'].includes(actionKey)) return 2;
  return 0;
}

async function sendRouletteLevelPoll(chatId, quoted, game, challengerMention, challengedMention, meta = null) {
  const image = await rouletteCardBuffer(chatId, meta, {
    title: 'ROLETA RUSSA',
    badge: 'ESCOLHA O NIVEL',
    status: 'aguardando escolha',
    shooter: game.challenger_id,
    target: game.challenged_id,
    round: 0,
    maxRounds: game.max_rounds,
    remaining: game.max_rounds,
    tone: 'pending'
  });
  const caption = [
    '*Roleta aberta*',
    '',
    `${challengerMention.text} desafiou ${challengedMention.text}.`,
    '',
    'Nivel 1: perde medalhas.',
    'Nivel 2: perde medalhas e sai do grupo.',
    '',
    `${challengerMention.text}, escolha com:`,
    `${prefix()}roletarussa nivel1`,
    `${prefix()}roletarussa nivel2`
  ].join('\n');
  debugLog('ROULETTE_LEVEL_PROMPT_OPEN', {
    chat: shortJid(chatId),
    gameId: game.id
  });
  return safeSendMessage(chatId, {
    image,
    caption,
    mentions: [challengerMention.jid, challengedMention.jid].filter(Boolean)
  }, { quoted }, 'rouletteLevelPrompt');
}

async function sendRouletteChallengePoll(chatId, quoted, game, challengerMention, challengedMention, meta = null) {
  const image = await rouletteCardBuffer(chatId, meta, {
    title: 'DESAFIO ABERTO',
    badge: `NIVEL ${rouletteRiskLevel(game)}`,
    status: 'aguardando resposta',
    shooter: game.challenger_id,
    target: game.challenged_id,
    round: 0,
    maxRounds: game.max_rounds,
    remaining: game.max_rounds,
    tone: 'pending'
  });
  const caption = [
    '*Desafio aberto*',
    '',
    `${challengerMention.text} x ${challengedMention.text}`,
    rouletteRiskLabel(game),
    '',
    `${challengedMention.text}, responda com:`,
    `${prefix()}roletarussa aceitar`,
    `${prefix()}roletarussa recusar`
  ].join('\n');
  debugLog('ROULETTE_PROMPT_OPEN', {
    chat: shortJid(chatId),
    gameId: game.id
  });
  return safeSendMessage(chatId, {
    image,
    caption,
    mentions: [challengerMention.jid, challengedMention.jid].filter(Boolean)
  }, { quoted }, 'rouletteChallengePrompt');
}

function rouletteRiskLevel(game = {}) {
  return Number(game.risk_level || 2) === 1 ? 1 : 2;
}

function rouletteRiskLabel(game = {}) {
  return rouletteRiskLevel(game) === 1
    ? 'Nivel 1: perdeu, perde medalha.'
    : 'Nivel 2: perdeu, perde medalha e sai do grupo.';
}

async function handleRoulettePollMessage(message) {
  const pollUpdate = message.message?.pollUpdateMessage;
  if (!pollUpdate?.pollCreationMessageKey?.id || !pollUpdate.vote) return false;
  const chatId = pollUpdate.pollCreationMessageKey.remoteJid || message.key.remoteJid;
  const pollId = pollUpdate.pollCreationMessageKey.id;
  const stored = roulettePolls.get(roulettePollKey(chatId, pollId));
  debugLog('ROULETTE_POLL_RAW_UPDATE', {
    chat: shortJid(chatId),
    pollId,
    voter: shortJid(senderJid(message)),
    stored: Boolean(stored)
  });
  if (!stored) return false;
  try {
    const meId = normalizeJid(sock.user?.id || sock.user?.jid || 'me');
    const voter = normalizeJid(getKeyAuthor(message.key, meId));
    const vote = decryptPollVote(pollUpdate.vote, {
      pollEncKey: stored.messageSecret,
      pollCreatorJid: getKeyAuthor(pollUpdate.pollCreationMessageKey, meId),
      pollMsgId: pollId,
      voterJid: voter
    });
    return handleRoulettePollSelection(chatId, pollId, voter, selectedRoulettePollOption(vote?.selectedOptions, stored.kind), message);
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (shouldLogPollDecryptFail('roulette', chatId, pollId, errorMessage)) {
      debugLog('ROULETTE_POLL_DECRYPT_FAIL', {
        chat: shortJid(chatId),
        pollId,
        error: errorMessage
      });
    }
    return true;
  }
}

async function handleRoulettePollUpdate(update) {
  const rawPollUpdate = update.update?.message?.pollUpdateMessage;
  if (rawPollUpdate) {
    return handleRoulettePollMessage({
      key: update.key,
      message: { pollUpdateMessage: rawPollUpdate }
    });
  }
  const pollUpdates = update.update?.pollUpdates || [];
  if (!pollUpdates.length || !update.key?.id) return false;
  const chatId = update.key.remoteJid;
  const pollId = update.key.id;
  const stored = roulettePolls.get(roulettePollKey(chatId, pollId));
  debugLog('ROULETTE_POLL_UPDATE', {
    chat: shortJid(chatId),
    pollId,
    updates: pollUpdates.length,
    stored: Boolean(stored)
  });
  if (!stored) return false;
  for (const pollUpdate of pollUpdates) {
    const meId = normalizeJid(sock.user?.id || sock.user?.jid || 'me');
    const voter = normalizeJid(getKeyAuthor(pollUpdate.pollUpdateMessageKey, meId));
    const handled = await handleRoulettePollSelection(chatId, pollId, voter, selectedRoulettePollOption(pollUpdate.vote?.selectedOptions, stored.kind), { key: pollUpdate.pollUpdateMessageKey, message: {} });
    if (handled) return true;
  }
  return false;
}

async function handleRoulettePollSelection(chatId, pollId, voter, selected, quoted) {
  if (!selected) {
    debugLog('ROULETTE_POLL_EMPTY_SELECTION', {
      chat: shortJid(chatId),
      pollId,
      voter: shortJid(voter)
    });
    return true;
  }
  const stored = roulettePolls.get(roulettePollKey(chatId, pollId));
  if (!stored) return false;
  const game = getRouletteGame(chatId);
  if (!game || game.id !== stored.gameId) {
    roulettePolls.delete(roulettePollKey(chatId, pollId));
    return true;
  }
  const meta = await sock.groupMetadata(chatId).catch(() => null);
  if (!meta) return true;
  if (stored.kind === 'level') {
    if (game.status !== 'level_pending') {
      roulettePolls.delete(roulettePollKey(chatId, pollId));
      return true;
    }
    if (!sameParticipant(voter, game.challenger_id)) {
      debugLog('ROULETTE_LEVEL_POLL_IGNORED', {
        chat: shortJid(chatId),
        pollId,
        voter: shortJid(voter),
        expected: shortJid(game.challenger_id),
        selected
      });
      return true;
    }
    const riskLevel = selected === 'level1' ? 1 : 2;
    const updated = setRouletteRiskLevel(chatId, game.id, riskLevel);
    roulettePolls.delete(roulettePollKey(chatId, pollId));
    const challengerMention = await mentionFor(chatId, updated.challenger_id, meta);
    const challengedMention = await mentionFor(chatId, updated.challenged_id, meta);
    debugLog('ROULETTE_LEVEL_SELECTED', {
      chat: shortJid(chatId),
      gameId: updated.id,
      riskLevel
    });
    return sendRouletteChallengePoll(chatId, quoted, updated, challengerMention, challengedMention, meta);
  }
  if (game.status !== 'pending') {
    roulettePolls.delete(roulettePollKey(chatId, pollId));
    return true;
  }
  if (!sameParticipant(voter, game.challenged_id)) {
    debugLog('ROULETTE_POLL_IGNORED', {
      chat: shortJid(chatId),
      pollId,
      voter: shortJid(voter),
      expected: shortJid(game.challenged_id),
      selected
    });
    return true;
  }
  roulettePolls.delete(roulettePollKey(chatId, pollId));
  debugLog('ROULETTE_POLL_SELECTED', {
    chat: shortJid(chatId),
    pollId,
    voter: shortJid(voter),
    selected
  });
  if (selected === 'accept') return rouletteAcceptCommand(chatId, meta, quoted, game, voter);
  if (selected === 'refuse') return rouletteRefuseCommand(chatId, meta, quoted, game, voter);
  return true;
}

function selectedRoulettePollOption(selectedOptions = [], kind = 'challenge') {
  const hashes = selectedOptions.map((option) => Buffer.from(option));
  if (kind === 'level') {
    if (hashes.some((hash) => hash.equals(pollOptionHash('Nivel 1 - perde medalhas')))) return 'level1';
    if (hashes.some((hash) => hash.equals(pollOptionHash('Nivel 2 - banido e perde medalhas')))) return 'level2';
  }
  if (hashes.some((hash) => hash.equals(pollOptionHash('Aceitar?')))) return 'accept';
  if (hashes.some((hash) => hash.equals(pollOptionHash('Recusar?')))) return 'refuse';
  return '';
}

function pollOptionHash(option = '') {
  return createHash('sha256').update(Buffer.from(option)).digest();
}

function roulettePollKey(chatId, pollId) {
  return `${chatId}:${pollId}`;
}

function pruneRoulettePolls() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [key, value] of roulettePolls.entries()) {
    if ((value.createdAt || 0) < cutoff) roulettePolls.delete(key);
  }
}

async function handleMenuPollMessage(message) {
  const pollUpdate = message.message?.pollUpdateMessage;
  if (!pollUpdate?.pollCreationMessageKey?.id || !pollUpdate.vote) return false;
  const chatId = pollUpdate.pollCreationMessageKey.remoteJid || message.key.remoteJid;
  const pollId = pollUpdate.pollCreationMessageKey.id;
  const stored = menuPolls.get(menuPollKey(chatId, pollId));
  debugLog('MENU_POLL_RAW_UPDATE', {
    chat: shortJid(chatId),
    pollId,
    voter: shortJid(senderJid(message)),
    stored: Boolean(stored)
  });
  if (!stored) return false;
  try {
    const meId = normalizeJid(sock.user?.id || sock.user?.jid || 'me');
    const voter = normalizeJid(getKeyAuthor(message.key, meId));
    const vote = decryptPollVote(pollUpdate.vote, {
      pollEncKey: stored.messageSecret,
      pollCreatorJid: getKeyAuthor(pollUpdate.pollCreationMessageKey, meId),
      pollMsgId: pollId,
      voterJid: voter
    });
    return handleMenuPollSelection(chatId, pollId, voter, selectedMenuPollCommand(vote?.selectedOptions, stored), message);
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (shouldLogPollDecryptFail('menu', chatId, pollId, errorMessage)) {
      debugLog('MENU_POLL_DECRYPT_FAIL', {
        chat: shortJid(chatId),
        pollId,
        error: errorMessage
      });
    }
    return true;
  }
}

async function handleMenuPollUpdate(update) {
  const rawPollUpdate = update.update?.message?.pollUpdateMessage;
  if (rawPollUpdate) {
    return handleMenuPollMessage({
      key: update.key,
      message: { pollUpdateMessage: rawPollUpdate }
    });
  }
  const pollUpdates = update.update?.pollUpdates || [];
  if (!pollUpdates.length || !update.key?.id) return false;
  const chatId = update.key.remoteJid;
  const pollId = update.key.id;
  const stored = menuPolls.get(menuPollKey(chatId, pollId));
  debugLog('MENU_POLL_UPDATE', {
    chat: shortJid(chatId),
    pollId,
    updates: pollUpdates.length,
    stored: Boolean(stored)
  });
  if (!stored) return false;
  for (const pollUpdate of pollUpdates) {
    const meId = normalizeJid(sock.user?.id || sock.user?.jid || 'me');
    const voter = normalizeJid(getKeyAuthor(pollUpdate.pollUpdateMessageKey, meId));
    const handled = await handleMenuPollSelection(chatId, pollId, voter, selectedMenuPollCommand(pollUpdate.vote?.selectedOptions, stored), { key: pollUpdate.pollUpdateMessageKey, message: {} });
    if (handled) return true;
  }
  return false;
}

async function handleMenuPollSelection(chatId, pollId, voter, command, quoted) {
  if (!command) {
    debugLog('MENU_POLL_EMPTY_SELECTION', {
      chat: shortJid(chatId),
      pollId,
      voter: shortJid(voter)
    });
    return true;
  }
  const stored = menuPolls.get(menuPollKey(chatId, pollId));
  if (!stored) return false;
  menuPolls.delete(menuPollKey(chatId, pollId));
  debugLog('MENU_POLL_SELECTED', {
    chat: shortJid(chatId),
    pollId,
    voter: shortJid(voter),
    command
  });
  const menuKey = getMenuCategory(command);
  if (menuKey) return sendMenuCard(chatId, menuKey, null);
  return executeMenuPollCommand(chatId, voter, command);
}

async function executeMenuPollCommand(chatId, voter, command) {
  const fake = {
    key: {
      remoteJid: chatId,
      participant: normalizeJid(voter),
      fromMe: false,
      id: `MENU-${Date.now()}-${Math.random().toString(16).slice(2)}`
    },
    message: {
      conversation: `${prefix()}${command}`
    },
    pushName: contactNameFor(voter) || ''
  };
  return processMessage(fake);
}

function selectedMenuPollCommand(selectedOptions = [], stored = {}) {
  const hashes = selectedOptions.map((option) => Buffer.from(option));
  for (const [label, command] of Object.entries(stored.options || {})) {
    if (hashes.some((hash) => hash.equals(pollOptionHash(label)))) return command;
  }
  return '';
}

function menuPollKey(chatId, pollId) {
  return `${chatId}:${pollId}`;
}

function pruneMenuPolls() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [key, value] of menuPolls.entries()) {
    if ((value.createdAt || 0) < cutoff) menuPolls.delete(key);
  }
}

async function rouletteTutorialCommand(chatId, quoted) {
  const image = await rouletteTutorialCardBuffer();
  const caption = [
    '*Tutorial da Roleta Russa*',
    '',
    `1. ${prefix()}roletarussa @pessoa`,
    `2. Quem desafiou escolhe: ${prefix()}roletarussa nivel1 ou nivel2.`,
    `3. O alvo responde: ${prefix()}roletarussa aceitar ou recusar.`,
    `4. No seu turno, use ${prefix()}roletarussa`,
    `5. ${prefix()}roletarussa placar`,
    `6. ${prefix()}roletarussa cancelar`,
    '',
    'Nivel 1: perdeu, perde medalha. Nivel 2: perdeu, perde medalha e sai do grupo.'
  ].join('\n');
  return safeSendMessage(chatId, { image, caption }, { quoted }, 'rouletteTutorial');
}

async function rouletteSelectLevelCommand(chatId, meta, quoted, game, sender, riskLevel) {
  if (!game || game.status !== 'level_pending') return sendText(chatId, 'Nao tem roleta aguardando escolha de nivel.', quoted);
  const challengerMention = await mentionFor(chatId, game.challenger_id, meta);
  if (!sameParticipant(sender, game.challenger_id)) {
    return sendMentionText(chatId, `So ${challengerMention.text} escolhe o nivel dessa roleta.`, [challengerMention.jid], quoted);
  }
  const updated = setRouletteRiskLevel(chatId, game.id, riskLevel);
  const challengedMention = await mentionFor(chatId, updated.challenged_id, meta);
  debugLog('ROULETTE_LEVEL_SELECTED_TEXT', {
    chat: shortJid(chatId),
    gameId: updated.id,
    riskLevel
  });
  return sendRouletteChallengePoll(chatId, quoted, updated, challengerMention, challengedMention, meta);
}

async function rouletteLevelPendingCommand(chatId, meta, quoted, game) {
  const challengerMention = await mentionFor(chatId, game.challenger_id, meta);
  const challengedMention = await mentionFor(chatId, game.challenged_id, meta);
  return sendMentionText(
    chatId,
    `Roleta aberta: ${challengerMention.text} x ${challengedMention.text}. Falta ${challengerMention.text} escolher: ${prefix()}roletarussa nivel1 ou ${prefix()}roletarussa nivel2.`,
    [challengerMention.jid, challengedMention.jid],
    quoted
  );
}

async function rouletteRefuseCommand(chatId, meta, quoted, game, sender) {
  if (!game || game.status !== 'pending') return sendText(chatId, 'Nao tem desafio de roleta aguardando resposta.', quoted);
  const challengerMention = await mentionFor(chatId, game.challenger_id, meta);
  const challengedMention = await mentionFor(chatId, game.challenged_id, meta);
  if (!sameParticipant(sender, game.challenged_id)) {
    return sendMentionText(chatId, `So ${challengedMention.text} pode recusar essa batalha.`, [challengedMention.jid], quoted);
  }
  cancelRouletteGame(chatId);
  debugLog('ROULETTE_REFUSE', {
    chat: shortJid(chatId),
    challenger: shortJid(game.challenger_id),
    challenged: shortJid(game.challenged_id)
  });
  const image = await rouletteCardBuffer(chatId, meta, {
    title: 'DESAFIO RECUSADO',
    badge: 'PORTA FECHADA',
    status: 'sem duelo hoje',
    shooter: game.challenger_id,
    target: game.challenged_id,
    round: 0,
    maxRounds: game.max_rounds,
    remaining: game.max_rounds,
    tone: 'danger'
  });
  const caption = [
    '*Roleta recusada*',
    '',
    `${challengedMention.text} recusou o desafio de ${challengerMention.text}.`
  ].join('\n');
  return safeSendMessage(chatId, {
    image,
    caption,
    mentions: [challengerMention.jid, challengedMention.jid].filter(Boolean)
  }, { quoted }, 'rouletteRefuse');
}

async function rouletteAcceptCommand(chatId, meta, quoted, game, sender) {
  if (!game || game.status !== 'pending') return sendText(chatId, 'Nao tem desafio de roleta aguardando aceite.', quoted);
  if (!sameParticipant(sender, game.challenged_id)) {
    const challengedMention = await mentionFor(chatId, game.challenged_id, meta);
    return sendMentionText(chatId, `So ${challengedMention.text} pode aceitar essa batalha.`, [challengedMention.jid], quoted);
  }
  const active = acceptRouletteChallenge(chatId, game.id);
  debugLog('ROULETTE_ACCEPT', {
    chat: shortJid(chatId),
    challenger: shortJid(active.challenger_id),
    challenged: shortJid(active.challenged_id)
  });
  const challengerMention = await mentionFor(chatId, active.challenger_id, meta);
  const challengedMention = await mentionFor(chatId, active.challenged_id, meta);
  const image = await rouletteCardBuffer(chatId, meta, {
    title: 'BATALHA INICIADA',
    badge: 'TAMBOR GIRANDO',
    status: 'turno aberto',
    shooter: active.current_shooter_id,
    target: active.challenged_id,
    round: active.current_round,
    maxRounds: active.max_rounds,
    remaining: active.max_rounds,
    tone: 'start'
  });
  const caption = [
    '*Batalha iniciada*',
    '',
    `${challengerMention.text} x ${challengedMention.text}`,
    rouletteRiskLabel(active),
    `Turno: ${challengerMention.text}`,
    `Rodadas restantes: ${active.max_rounds}`,
    `Use ${prefix()}roletarussa para puxar o gatilho.`
  ].join('\n');
  return safeSendMessage(chatId, {
    image,
    caption,
    mentions: [challengerMention.jid, challengedMention.jid].filter(Boolean)
  }, { quoted }, 'rouletteAccept');
}

async function roulettePendingCommand(chatId, meta, quoted, game, sender) {
  const challengedMention = await mentionFor(chatId, game.challenged_id, meta);
  const challengerMention = await mentionFor(chatId, game.challenger_id, meta);
  if (sameParticipant(sender, game.challenged_id)) {
    return sendMentionText(chatId, `${challengedMention.text}, responda com ${prefix()}roletarussa aceitar ou ${prefix()}roletarussa recusar.`, [challengedMention.jid], quoted);
  }
  return sendMentionText(chatId, `Ja tem desafio aberto: ${challengerMention.text} x ${challengedMention.text}.`, [challengerMention.jid, challengedMention.jid], quoted);
}

async function rouletteShotCommand(chatId, meta, quoted, game, sender) {
  if (!sameParticipant(sender, game.current_shooter_id)) {
    const turnMention = await mentionFor(chatId, game.current_shooter_id, meta);
    return sendMentionText(chatId, `Turno de ${turnMention.text}.`, [turnMention.jid], quoted);
  }
  const opponent = sameParticipant(sender, game.challenger_id) ? game.challenged_id : game.challenger_id;
  const round = Number(game.current_round || 0) + 1;
  const remaining = Math.max(0, Number(game.max_rounds || 6) - round);
  const hit = round >= Number(game.bullet_round || game.max_rounds || 6);
  addRouletteShot(chatId, sender, { shots: 1, survived: hit ? 0 : 1 });
  const shooterMention = await mentionFor(chatId, sender, meta);
  const opponentMention = await mentionFor(chatId, opponent, meta);

  debugLog('ROULETTE_SHOT', {
    chat: shortJid(chatId),
    shooter: shortJid(sender),
    target: shortJid(sender),
    opponent: shortJid(opponent),
    round,
    remaining,
    hit
  });

  if (hit) {
    finishRouletteGame(chatId, game.id, opponent, sender);
    addRouletteResult(chatId, opponent, sender);
    const stats = getRouletteStats(chatId, opponent);
    const loserStats = getRouletteStats(chatId, sender);
    const riskLevel = rouletteRiskLevel(game);
    const image = await rouletteCardBuffer(chatId, meta, {
      title: 'FIM DA BATALHA',
      badge: 'PERDEDOR DEFINIDO',
      status: 'tiro certeiro',
      shooter: sender,
      target: opponent,
      round,
      maxRounds: game.max_rounds,
      remaining,
      tone: 'danger',
      medals: stats.medals
    });
    const caption = [
      '*Roleta encerrada*',
      '',
      `Vencedor: ${opponentMention.text}`,
      `Perdedor: ${shooterMention.text}`,
      rouletteRiskLabel(game),
      `Medalhas do vencedor: ${stats.medals}`,
      `Medalhas do perdedor: ${loserStats.medals}`
    ].join('\n');
    await safeSendMessage(chatId, {
      image,
      caption,
      mentions: [shooterMention.jid, opponentMention.jid].filter(Boolean)
    }, { quoted }, 'rouletteFinish');
    if (riskLevel === 2) {
      await sleep(900);
      const kickId = participantActionJid(meta, sender);
      await sock.groupParticipantsUpdate(chatId, [kickId], 'remove').catch(async (error) => {
        debugLog('ROULETTE_KICK_FAIL', { chat: shortJid(chatId), target: shortJid(kickId), error: error?.message || String(error) });
        await sendMentionText(chatId, `${shooterMention.text} perdeu, mas nao consegui remover.`, [shooterMention.jid], quoted);
      });
    }
    return;
  }

  advanceRouletteRound(chatId, game.id, opponent, round);
  const image = await rouletteCardBuffer(chatId, meta, {
    title: 'RODADA SEGURA',
    badge: `RODADA ${round}`,
    status: 'passou raspando',
    shooter: sender,
    target: opponent,
    round,
    maxRounds: game.max_rounds,
    remaining,
    tone: 'safe'
  });
  const caption = [
    '*Roleta Russa do Cleiton*',
    '',
    `${shooterMention.text} puxou o gatilho e sobreviveu.`,
    `Proximo turno: ${opponentMention.text}`,
    `Rodadas restantes: ${remaining}`,
    `Use ${prefix()}roletarussa para puxar o gatilho.`
  ].join('\n');
  return safeSendMessage(chatId, {
    image,
    caption,
    mentions: [shooterMention.jid, opponentMention.jid].filter(Boolean)
  }, { quoted }, 'rouletteSafe');
}

async function rouletteCancelCommand(chatId, meta, quoted) {
  const game = getRouletteGame(chatId);
  if (!game) return sendText(chatId, 'Nao tem roleta ativa para cancelar.', quoted);
  const sender = senderJid(quoted);
  const actor = findParticipant(meta, sender);
  const allowed = await isOwner(sender)
    || actor?.admin
    || sameParticipant(sender, game.challenger_id)
    || sameParticipant(sender, game.challenged_id)
    || sameParticipant(sender, game.current_shooter_id);
  if (!allowed) return sendText(chatId, 'So jogador da partida ou admin cancela essa roleta.', quoted);
  cancelRouletteGame(chatId);
  debugLog('ROULETTE_CANCEL', { chat: shortJid(chatId), by: shortJid(sender) });
  return sendText(chatId, 'Roleta cancelada.', quoted);
}

async function rouletteScoreCommand(chatId, meta, quoted) {
  const rows = topRouletteStats(chatId, 8);
  if (!rows.length) return sendText(chatId, 'Ainda nao tem medalhas de honra registradas.', quoted);
  const lines = await Promise.all(rows.map(async (row, index) => {
    const mention = await mentionFor(chatId, row.user_id, meta);
    return `${index + 1}. ${mention.text} - ${row.medals} medalha(s), ${row.wins} vitoria(s), ${row.survived} escape(s)`;
  }));
  const mentions = await Promise.all(rows.map((row) => mentionFor(chatId, row.user_id, meta)));
  return sendMentionText(chatId, ['*Medalhas da Roleta*', '', ...lines].join('\n'), mentions.map((item) => item.jid), quoted);
}

async function effectImageCommand(chatId, command, quoted) {
  const target = targetJid(quoted) || senderJid(quoted);
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const mention = await mentionFor(chatId, target, meta);
  const image = await effectCardBuffer(command, await targetAvatarBuffer(chatId, target, meta), mention.text);
  return safeSendMessage(chatId, { image, caption: `${command.toUpperCase()} registrado pelo Cleiton.`, mentions: mention.jid ? [mention.jid] : [] }, { quoted }, `${command}Image`);
}

async function captionImageCommand(chatId, args, quoted) {
  if (!args) return sendText(chatId, `Responda uma imagem com ${prefix()}legendaimg seu texto`, quoted);
  const media = getMediaMessage(quoted);
  if (!media) return sendText(chatId, 'Responda uma imagem para eu colocar legenda.', quoted);
  const image = await captionImageBuffer(await downloadMedia(media), args);
  return safeSendMessage(chatId, { image, caption: 'Legenda aplicada pelo Cleiton.' }, { quoted }, 'captionImage');
}

async function noticeImageCommand(chatId, args, quoted) {
  if (!args) return sendText(chatId, `Use assim: ${prefix()}aviso reunião as 20h`, quoted);
  const image = await noticeImageBuffer('AVISO', args, 'Cleiton confirmou e fixou no mural.');
  return safeSendMessage(chatId, { image, caption: 'Aviso registrado.' }, { quoted }, 'noticeImage');
}

async function translateCommand(chatId, args, quoted) {
  const ctx = quoted.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedText = ctx ? extractText({ message: ctx }) : '';
  const input = (args || quotedText || '').trim();
  if (!input) return sendText(chatId, `Use ${prefix()}traduzir texto ou responda uma mensagem com ${prefix()}traduzir.`, quoted);
  await sendTyping(chatId);
  try {
    const result = await translateToPortuguese(input);
    const sourceLabel = result.detected ? languageLabel(result.detected) : 'idioma detectado';
    return sendText(chatId, [
      '*Traducao para portugues*',
      `Idioma detectado: ${sourceLabel}`,
      '',
      result.text
    ].join('\n'), quoted);
  } catch (error) {
    debugLog('TRANSLATE_FAIL', { error: error?.message || String(error) });
    if (gemini) {
      const fallback = await cleitonConversationAnswer(quoted, `Traduza para portugues brasileiro, respondendo apenas a traducao:\n\n${input}`);
      if (fallback) return sendText(chatId, `*Traducao para portugues*\n\n${fallback}`, quoted);
    }
    return sendText(chatId, 'A traducao travou. Tenta de novo daqui a pouco.', quoted);
  }
}

async function translateToPortuguese(text) {
  const chunks = splitTranslateText(text, 1700);
  const translated = [];
  let detected = '';
  for (const chunk of chunks) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=${encodeURIComponent(chunk)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`translate status ${response.status}`);
    const payload = await response.json();
    const lines = Array.isArray(payload?.[0])
      ? payload[0].map((item) => item?.[0]).filter(Boolean).join('')
      : '';
    if (!lines) throw new Error('traducao vazia');
    translated.push(lines);
    detected ||= payload?.[2] || payload?.[8]?.[0]?.[0] || '';
  }
  return { text: translated.join('\n\n').trim(), detected };
}

function splitTranslateText(text, maxLength = 1700) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return [value];
  const parts = [];
  let rest = value;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf('\n', maxLength);
    if (cut < maxLength * 0.55) cut = rest.lastIndexOf('. ', maxLength);
    if (cut < maxLength * 0.55) cut = rest.lastIndexOf(' ', maxLength);
    if (cut < 1) cut = maxLength;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function languageLabel(code = '') {
  const normalized = String(code || '').split('-')[0].toLowerCase();
  const known = {
    en: 'ingles',
    es: 'espanhol',
    fr: 'frances',
    de: 'alemao',
    it: 'italiano',
    ja: 'japones',
    ko: 'coreano',
    zh: 'chines',
    ru: 'russo',
    ar: 'arabe',
    pt: 'portugues'
  };
  if (known[normalized]) return known[normalized];
  try {
    return new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(normalized) || normalized;
  } catch {
    return normalized || 'automatico';
  }
}

async function aiToolCommand(chatId, command, args, quoted) {
  const ctx = quoted.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedText = ctx ? extractText({ message: ctx }) : '';
  const input = args || quotedText;
  if (!input) return sendText(chatId, `Use ${prefix()}${command} texto ou responda uma mensagem com o comando.`, quoted);
  const prompts = {
    resumir: `Resuma em poucas linhas: ${input}`,
    corrigir: `Corrija a gramatica mantendo o sentido e responda apenas o texto corrigido: ${input}`,
    ideia: `Gere ideias praticas e curtas sobre: ${input}`,
    ideias: `Gere ideias praticas e curtas sobre: ${input}`,
    Cleiton: `Responda em tom de Cleiton educado, claro e util: ${input}`
  };
  await sendTyping(chatId);
  return sendText(chatId, await cleitonConversationAnswer(quoted, prompts[command] || input), quoted);
}

async function profileCommand(chatId, args, quoted) {
  try {
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const target = resolveProfileTarget(meta, args, quoted);
  const participant = findParticipant(meta, target);
  const mention = await mentionFor(chatId, target, meta);
  const pn = await pnForJid(participant?.phoneNumber || target);
  const displayJid = normalizeJid(pn || participant?.phoneNumber || participant?.id || target);
  const contactId = normalizeJid(participant?.id || target);
  const targetIsSender = sameParticipant(target, senderJid(quoted));
  const typedMentionName = mentionNameFromMessage(quoted, target);
  const mentionDisplayName = mentionNameText(mention.text);
  const cachedProfileName = cachedMemberName(chatId, target, meta, quoted, mention);
  const cachedName = contactNameFor(target, displayJid, contactId, participant?.phoneNumber, participant?.id, participant?.lid);
  const name = typedMentionName || cachedProfileName || mentionDisplayName || cachedName || participantName(participant, target) || (targetIsSender ? quoted.pushName : '') || 'sem cracha';
  cacheMemberProfile(chatId, target, meta, { name, mappedPn: pn });
  const isAdmin = Boolean(participant?.admin);
  const warnings = getWarningCount(chatId, contactId);
  const mute = getActiveMute(chatId, contactId);
  const phone = onlyDigits(displayJid);
  const cleanMentions = mention?.jid ? [mention.jid] : [];
  debugLog('PROFILE_RESOLVE', {
    chat: shortJid(chatId),
    args: compactText(args),
    sender: shortJid(senderJid(quoted)),
    mentions: mentionedJids(quoted).map(shortJid).join(','),
    quotedParticipant: shortJid(quoted.message?.extendedTextMessage?.contextInfo?.participant || ''),
    target: shortJid(target),
    participantId: shortJid(participant?.id || ''),
    participantLid: shortJid(participant?.lid || ''),
    participantPhone: shortJid(participant?.phoneNumber || ''),
    typedMentionName,
    mentionDisplayName,
    cachedName,
    mentionText: mention.text,
    mentionJid: shortJid(mention.jid),
    displayJid: shortJid(displayJid),
    contactId: shortJid(contactId),
    name
  });
  const caption = [
    '*Ficha do chat*',
    '',
    `*Nome:* ${name}`,
    `*Mencao:* ${mention.real ? mention.text : 'sem @ publico'}`,
    `*Número:* ${phone ? `+${phone}` : 'não revelado'}`,
    `*Cargo:* ${isAdmin ? 'admin do grupo' : 'membro'}`,
    `*Advertencias:* ${warnings}`,
    `*Mute:* ${mute ? 'ativo' : 'nao'}`,
    '',
    '_Cleiton conferiu o perfil._'
  ].join('\n');
  const safeCaption = caption
    .replace(/\*N.*mero:\*/u, '*Numero:*')
    .replace('nÃ£o revelado', 'oculto')
    .replace('_Cleiton conferiu o perfil._', '_Cleiton conferiu o perfil e liberou a ficha._');

  const displayCaption = [
    '*Ficha do chat*',
    '',
    `*Nome:* ${name}`,
    `*Mencao:* ${mention.real ? mention.text : 'sem @ publico'}`,
    `*Numero:* ${phone ? `+${phone}` : 'oculto'}`,
    `*Cargo:* ${isAdmin ? 'admin do grupo' : 'membro'}`,
    `*Advertencias:* ${warnings}`,
    `*Mute:* ${mute ? 'ativo' : 'nao'}`,
    '',
    '_Cleiton conferiu o perfil e liberou a ficha._'
  ].join('\n');

  const image = await withTimeout(profileImageBuffer(displayJid, contactId, participant?.phoneNumber, participant?.id, participant?.lid), 9000, null);
  debugLog('PROFILE_IMAGE', { target: shortJid(target), hasImage: Boolean(image) });
  if (image) {
    await safeSendMessage(chatId, { image, caption: displayCaption, mentions: cleanMentions }, { quoted }, 'profileImage');
    return;
  }
  await sendMentionText(chatId, displayCaption, cleanMentions, quoted);
  } catch (error) {
    console.error('Erro no !perfil:', error);
    logEvent({ level: 'error', event: 'baileys_profile_error', userId: senderJid(quoted), message: error?.stack || String(error) });
    if (isConnectionClosedError(error)) scheduleReconnect('perfil falhou: conexao fechada', 1500);
    await sendText(chatId, 'O perfil travou. Tenta responder uma mensagem da pessoa ou marcar ela de novo.', quoted);
  }
}

async function revealViewOnceCommand(chatId, quoted) {
  const ctx = quoted.message?.extendedTextMessage?.contextInfo;
  const hasQuoted = Boolean(ctx?.quotedMessage);
  if (!hasQuoted) {
    return sendText(chatId, `Responda uma mensagem de visualização única com ${prefix()}revelar.`, quoted);
  }
  await sendText(chatId, 'Não posso revelar mídia de visualização única. Essa trava é privacidade do WhatsApp; pede para a pessoa reenviar como mídia normal que eu trabalho em cima.', quoted);
}

async function tagAll(chatId, args, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const mentionItems = await Promise.all(meta.participants.map((p) => mentionFor(chatId, p.id, meta)));
  for (const item of mentionItems) {
    cacheMemberProfile(chatId, item.jid, meta, { name: mentionNameText(item.text) });
  }
  const text = `${args || 'Chamada geral do Cleiton. Todo mundo no chat.'}\n\n${mentionItems.map((item) => item.text).join(' ')}`;
  await sock.sendMessage(chatId, { text, mentions: mentionItems.map((item) => item.jid) }, { quoted });
}

async function stickerCommand(chatId, quoted) {
  const mediaMessage = getMediaMessage(quoted);
  if (!mediaMessage) return sendText(chatId, `Responda ou envie uma imagem com ${prefix()}sticker.`, quoted);
  const buffer = await downloadMedia(mediaMessage);
  const webp = await sharp(buffer).resize(512, 512, { fit: 'inside' }).webp().toBuffer();
  await sock.sendMessage(chatId, { sticker: webp }, { quoted });
}

async function textStickerCommand(chatId, command, args, quoted) {
  const text = args?.trim();
  if (!text) return sendText(chatId, `Use assim: ${prefix()}${command} seu texto`, quoted);
  const webp = await textStickerWebp(text, command);
  await sock.sendMessage(chatId, { sticker: webp }, { quoted });
}

async function textStickerWebp(text, command) {
  const safeText = escapeXml(text).slice(0, 80);
  const words = wrapStickerWords(safeText, command === 'attp' ? 9 : 11).slice(0, 4);
  const fontSize = Math.max(54, Math.min(112, Math.floor(520 / Math.max(...words.map((line) => line.length), 4))));
  const startY = 256 - ((words.length - 1) * fontSize * 0.58);
  const variant = command === 'attp';
  const frames = [];
  const palette = [
    ['#ff004c', '#ffea00', '#00ff85', '#00c3ff', '#b700ff'],
    ['#00ff85', '#00c3ff', '#b700ff', '#ff004c', '#ffea00'],
    ['#00c3ff', '#b700ff', '#ff004c', '#ffea00', '#00ff85'],
    ['#b700ff', '#ff004c', '#ffea00', '#00ff85', '#00c3ff'],
    ['#ffea00', '#00ff85', '#00c3ff', '#b700ff', '#ff004c']
  ];

  for (let frame = 0; frame < palette.length; frame += 1) {
    const colors = palette[frame];
    const wobble = variant ? Math.sin(frame) * 6 : 0;
    const textLines = words.map((line, index) => {
      const y = startY + index * fontSize * 1.1;
      const x = 256 + wobble * (index % 2 ? -1 : 1);
      return `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial Black, Impact, Arial, sans-serif" font-size="${fontSize}" font-weight="900" stroke="${variant ? '#ffffff' : '#101010'}" stroke-width="${variant ? 7 : 5}" paint-order="stroke" fill="url(#rgbText)">${line}</text>`;
    }).join('\n');
    const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rgbText" x1="${frame * 18}%" y1="0%" x2="${100 + frame * 18}%" y2="0%">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="25%" stop-color="${colors[1]}"/>
      <stop offset="50%" stop-color="${colors[2]}"/>
      <stop offset="75%" stop-color="${colors[3]}"/>
      <stop offset="100%" stop-color="${colors[4]}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="${variant ? 3.5 : 2}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" fill="none"/>
  <g filter="url(#glow)">${textLines}</g>
</svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }

  return sharp(frames, {
    animated: true,
    join: {
      across: 1,
      animated: true
    }
  }).webp({
    loop: 0,
    delay: palette.map(() => variant ? 90 : 120),
    quality: 92,
    effort: 4
  }).toBuffer();
}

async function downloadCommand(chatId, args, kind, quoted) {
  if (!args) return sendText(chatId, `Use assim: ${prefix()}${kind === 'audio' ? 'play' : 'video'} nome ou link.`, quoted);
  const out = join(tempDir, `cleiton-${Date.now()}.${kind === 'audio' ? 'mp3' : 'mp4'}`);
  try {
    const media = kind === 'audio'
      ? await resolveYouTubeMedia(args)
      : { url: /^https?:\/\//i.test(args) ? args : await youtubeUrl(args), title: args };
    const url = media.url;
    if (kind === 'audio') await sendPlayPreview(chatId, media, quoted);
    else await sendText(chatId, 'Cleiton foi buscar o video no chat de midia.', quoted);

    const commonOptions = { output: out, noPlaylist: true, ffmpegLocation: ffmpegPath };
    const options = kind === 'audio'
      ? { ...commonOptions, extractAudio: true, audioFormat: 'mp3', audioQuality: 5 }
      : { ...commonOptions, format: 'mp4/bestvideo[height<=480]+bestaudio/best[height<=480]' };
    await ytdlp(url, options);
    if (kind === 'audio') {
      await sock.sendMessage(chatId, { audio: readFileSync(out), mimetype: 'audio/mpeg', ptt: false }, { quoted });
    } else {
      await sock.sendMessage(chatId, { video: readFileSync(out), caption: 'Video registrado pelo Cleiton.' }, { quoted });
    }
  } catch (error) {
    debugLog('DOWNLOAD_FAIL', { kind, query: compactText(args), error: error?.message || String(error) });
    await sendText(chatId, kind === 'audio'
      ? 'Nao consegui achar ou baixar essa musica agora. Manda o link direto que o Cleiton tenta pelo atalho.'
      : 'Nao consegui achar ou baixar esse video agora. Manda o link direto que facilita.', quoted);
  } finally {
    safeUnlink(out);
  }
}

async function sendPlayPreview(chatId, media, quoted) {
  const image = await playStatsCardBuffer(media);
  await safeSendMessage(chatId, {
    image,
    caption: 'Ficha da musica registrada. Cleiton vai enviar o audio agora.'
  }, { quoted }, 'playStatsCard');
}

async function resolveYouTubeMedia(query) {
  if (/^https?:\/\//i.test(query)) {
    const info = await ytdlp(query, {
      dumpSingleJson: true,
      noPlaylist: true,
      noWarnings: true,
      skipDownload: true
    }).catch(() => null);
    return normalizeYouTubeInfo({ ...(info || {}), url: info?.webpage_url || query });
  }
  const srResult = await YouTube.search(query, { limit: 1, type: 'video' })
    .then((results) => results?.[0])
    .catch((error) => {
      debugLog('YOUTUBE_SR_FAIL', { query: compactText(query), error: error?.message || String(error) });
      return null;
    });
  if (srResult?.url) return normalizeYouTubeInfo(srResult);

  const ytResult = await ytSearch(query)
    .then((results) => results?.videos?.[0])
    .catch((error) => {
      debugLog('YT_SEARCH_FAIL', { query: compactText(query), error: error?.message || String(error) });
      return null;
    });
  if (ytResult?.url) return normalizeYouTubeInfo(ytResult);

  const dlResult = await ytdlp(`ytsearch1:${query}`, {
    dumpSingleJson: true,
    noPlaylist: true,
    noWarnings: true,
    skipDownload: true
  }).catch((error) => {
    debugLog('YTDLP_SEARCH_FAIL', { query: compactText(query), error: error?.message || String(error) });
    return null;
  });
  const entry = dlResult?.entries?.[0] || dlResult;
  if (entry?.url || entry?.webpage_url) return normalizeYouTubeInfo(entry);
  throw new Error('Nada encontrado no YouTube.');
}

function normalizeYouTubeInfo(info = {}) {
  const channel = info.channel?.name || info.channel?.title || info.author?.name || info.uploader || info.creator || '';
  const duration = info.duration || info.durationInSec || info.durationSeconds || info.lengthSeconds || 0;
  return {
    url: info.webpage_url || info.url,
    title: info.title || info.name || 'Musica encontrada',
    singer: info.artist || info.creator || info.uploader || channel || 'nao informado',
    band: info.album || channel || info.artist || 'nao informado',
    channel,
    duration: typeof duration === 'number' ? formatMusicDuration(duration) : (info.durationFormatted || info.timestamp || String(duration || 'nao informado')),
    views: Number(info.views || info.view_count || 0) || 0,
    thumbnail: bestThumbnailUrl(info),
    artistIcon: bestArtistIconUrl(info)
  };
}

async function tiktokCommand(chatId, args, quoted) {
  if (!args) return sendText(chatId, `Use assim: ${prefix()}tkk link do TikTok ou nome do video.`, quoted);
  await sendText(chatId, 'Cleiton foi caçar esse TikTok no corredor do Cleiton.', quoted);
  const target = /^https?:\/\//i.test(args) ? args : `ytsearch1:${args} tiktok`;
  const out = join(tempDir, `cleiton-tiktok-${Date.now()}.mp4`);
  try {
    await ytdlp(target, {
      output: out,
      noPlaylist: true,
      ffmpegLocation: ffmpegPath,
      format: 'mp4/best[height<=720]/best',
      mergeOutputFormat: 'mp4'
    });
    await safeSendMessage(chatId, { video: readFileSync(out), caption: 'TikTok registrado pelo Cleiton.' }, { quoted }, 'tiktokVideo');
  } catch (error) {
    debugLog('TIKTOK_FAIL', { query: compactText(args), error: error?.message || String(error) });
    await sendText(chatId, 'Não consegui baixar esse TikTok. Se foi por nome, manda o link direto que o Cleiton corre menos risco de tropeçar.', quoted);
  } finally {
    safeUnlink(out);
  }
}

async function youtubeUrl(query) {
  return (await resolveYouTubeMedia(query)).url;
}

async function rankCommand(chatId, quoted, command = 'rank') {
  const rows = topActivity(chatId, 5);
  if (!rows.length) return sendText(chatId, 'Ranking vazio. Cleiton ainda está apontando o lápis.', quoted);
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const mentionItems = rows.map((row) => mentionFromParticipant(findParticipant(meta, row.user_id), row.user_id));
  const label = command === 'ranksemanal' ? 'Top semanal do Cleiton' : command === 'rankmensal' ? 'Top mensal do Cleiton' : 'Top membros do Cleiton';
  const items = rows.map((row, index) => ({
    label: rankDisplayName(mentionItems[index], findParticipant(meta, row.user_id), row.user_id, index),
    value: activityCount(row)
  }));
  const image = await rankGraphicBuffer(items, label);
  await safeSendMessage(chatId, { image, caption: `${label}.`, mentions: mentionItems.map((item) => item.jid).filter(Boolean) }, { quoted }, 'rankCard');
}

async function reportCommand(chatId, quoted) {
  if (!await isOwner(senderJid(quoted))) return sendText(chatId, 'Relatorio completo e so para o dono do chat.', quoted);
  const rows = topActivity(chatId, 5);
  const totalMessages = rows.reduce((sum, row) => sum + activityCount(row), 0);
  const totalMedia = rows.reduce((sum, row) => sum + Number(row.media || 0), 0);
  const meta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null;
  const lines = rows.map((row, i) => {
    const mention = mentionFromParticipant(findParticipant(meta, row.user_id), row.user_id);
    return `${i + 1}. ${mention.text} - ${activityCount(row)} msgs / ${row.media || 0} midias`;
  });
  const image = await reportCardBuffer({
    group: meta?.subject || chatId,
    members: meta?.participants?.length || '-',
    totalMessages,
    totalMedia,
    lines
  });
  return safeSendMessage(chatId, { image, caption: 'Relatorio do Cleiton.' }, { quoted }, 'reportCard');
}

async function deleteQuotedCommand(chatId, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const ctx = quoted.message?.extendedTextMessage?.contextInfo;
  const body = extractText(quoted);
  const count = Math.min(Number(body.split(/\s+/)[1]) || 1, 50);
  const target = ctx?.participant || targetJid(quoted) || null;
  const list = recentMessages.get(chatId) || [];
  const toDelete = [];
  debugLog('DELETE_REQUEST', {
    chat: shortJid(chatId),
    sender: shortJid(senderJid(quoted)),
    count,
    target: shortJid(target || ''),
    quotedId: ctx?.stanzaId || '',
    storeSize: list.length
  });

  if (ctx?.stanzaId) {
    const stored = list.find((item) => item.key.id === ctx.stanzaId);
    toDelete.push(stored || {
      key: {
        remoteJid: chatId,
        id: ctx.stanzaId,
        participant: ctx.participant,
        fromMe: Boolean(ctx.participant && isBotParticipant(ctx.participant))
      }
    });
  }

  for (let i = list.length - 1; i >= 0 && toDelete.length < count; i--) {
    const item = list[i];
    if (item.key.id === quoted.key.id || toDelete.some((old) => old.key.id === item.key.id)) continue;
    const participant = item.key.participant || item.key.remoteJid;
    if (target && !sameParticipant(participant, target)) continue;
    toDelete.push(item);
  }

  if (!toDelete.length) return sendText(chatId, 'Responda a mensagem que eu devo apagar, ou use !del 3 para apagar recentes.', quoted);
  try {
    debugLog('DELETE_SELECTED', {
      total: toDelete.length,
      ids: toDelete.map((item) => item.key.id).join(',')
    });
    for (const item of toDelete) {
      debugLog('DELETE_SEND', {
        id: item.key.id,
        participant: shortJid(item.key.participant || ''),
        fromMe: Boolean(item.key.fromMe)
      });
      await sock.sendMessage(chatId, {
        delete: {
          remoteJid: chatId,
          fromMe: Boolean(item.key.fromMe),
          id: item.key.id,
          participant: item.key.participant || undefined
        }
      });
      await sleep(250);
    }
  } catch (error) {
    logEvent({ level: 'warn', event: 'baileys_delete_error', userId: senderJid(quoted), message: error?.message || String(error) });
    await sendText(chatId, 'Nao consegui apagar. Confere se eu sou admin e se voce respondeu a mensagem certa.', quoted);
  }
}

async function groupAdminCommand(chatId, command, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  if (command === 'fechargp' || command === 'closegp') {
    await sock.groupSettingUpdate(chatId, 'announcement');
    return sendModerationCard(chatId, 'GRUPO FECHADO', 'So a diretoria fala agora.', 'Fechadura trocada pelo Cleiton.', [], quoted, 'groupClosed');
  }
  if (command === 'abrirgp' || command === 'opengp') {
    await sock.groupSettingUpdate(chatId, 'not_announcement');
    return sendModerationCard(chatId, 'GRUPO ABERTO', 'Falem com responsabilidade.', 'Antenas do Cleiton continuam ligadas.', [], quoted, 'groupOpened');
  }
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, 'Marque ou responda quem vai ser alvo.', quoted);
  const mention = mentionFromParticipant(findParticipant(meta, target), target);
  if (command === 'promover' || command === 'promote') {
    await sock.groupParticipantsUpdate(chatId, [target], 'promote');
    return sendModerationCard(chatId, 'PROMOVIDO', displayNameForCard(chatId, target, meta, quoted, mention), 'Permissao administrativa liberada.', [mention.jid], quoted, 'promoteCard', target);
  }
  if (command === 'rebaixar' || command === 'demote') {
    await sock.groupParticipantsUpdate(chatId, [target], 'demote');
    return sendModerationCard(chatId, 'REBAIXADO', displayNameForCard(chatId, target, meta, quoted, mention), 'Cargo ajustado no chat.', [mention.jid], quoted, 'demoteCard', target);
  }
  await sock.groupParticipantsUpdate(chatId, [target], 'remove');
  addHistory(chatId, target, command, senderJid(quoted), 'baileys');
  await sendModerationCard(chatId, 'REMOVIDO', displayNameForCard(chatId, target, meta, quoted, mention), 'Saida registrada pela Cleiton.', [mention.jid], quoted, 'kickCard', target);
}

async function exitAudioCommand(chatId, quoted) {
  if (!chatId.endsWith('@g.us')) return sendText(chatId, 'Esse comando só funciona em grupo.', quoted);
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const sent = await sendGroupExitAudio(chatId, { force: true, quoted });
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio de saída agora.', quoted);
}

async function pesteAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, pesteAudioPath, quoted, 'pesteAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio do peste agora.', quoted);
}

async function gloriaAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, gloriaAudioPath, quoted, 'gloriaAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio da glória agora.', quoted);
}

async function armandoAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, armandoAudioPath, quoted, 'armandoAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio do Armando agora.', quoted);
}

async function duvidaAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, duvidaAudioPath, quoted, 'duvidaAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio da dúvida agora.', quoted);
}

async function bloquearAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, bloquearAudioPath, quoted, 'bloquearAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio de bloquear agora.', quoted);
}

async function costaAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, costaAudioPath, quoted, 'costaAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio de costa agora.', quoted);
}

async function pacienciaAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, pacienciaAudioPath, quoted, 'pacienciaAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio de paciência agora.', quoted);
}

async function superboneAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, superboneAudioPath, quoted, 'superboneAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio do Superbone agora.', quoted);
}

async function acheiGracaAudioCommand(chatId, quoted) {
  const sent = await sendVoiceAsset(chatId, acheiGracaAudioPath, quoted, 'acheiGracaAudio');
  if (!sent) return sendText(chatId, 'Não consegui enviar o áudio de achei graça agora.', quoted);
}

async function ownerPromoteSelfCommand(chatId, quoted) {
  if (!chatId.endsWith('@g.us')) return sendText(chatId, 'Esse comando só funciona em grupo.', quoted);
  const sender = senderJid(quoted);
  const meta = await requireGroupAdmin(chatId, sender, quoted);
  if (!meta) return;

  const actor = findParticipant(meta, sender);
  const owner = await isOwner(sender)
    || await isOwner(actor?.phoneNumber)
    || await isOwner(actor?.id)
    || await isOwner(actor?.lid);
  if (!owner) return sendText(chatId, 'Esse comando é só para dono do bot.', quoted);
  if (actor?.admin) return sendText(chatId, 'Você já é admin nesse grupo.', quoted);

  const target = participantActionJid(meta, actor?.id || actor?.phoneNumber || actor?.lid || sender);
  const mention = await mentionFor(chatId, target, meta);
  try {
    await sock.groupParticipantsUpdate(chatId, [target], 'promote');
    await sendDiscordLog('Dono promovido no grupo', `${meta.subject || shortJid(chatId)} atualizou permissões do dono.`, [
      { name: 'Grupo', value: meta.subject || shortJid(chatId), inline: true },
      { name: 'Dono', value: shortJid(target), inline: true }
    ], 0x22c55e);
    return sendModerationCard(chatId, 'ADMIN ATIVADO', displayNameForCard(chatId, target, meta, quoted, mention), 'Permissão administrativa liberada.', [mention.jid], quoted, 'ownerPromoteCard', target);
  } catch (error) {
    debugLog('OWNER_PROMOTE_FAIL', { chat: shortJid(chatId), target: shortJid(target), error: error?.message || String(error) });
    return sendText(chatId, 'Não consegui te promover. Confere se o Cleiton está como admin e se tem permissão para promover membros.', quoted);
  }
}

async function archiveGroupCommand(chatId, quoted) {
  if (!chatId.endsWith('@g.us')) return sendText(chatId, 'Esse comando só funciona em grupo.', quoted);
  if (!await isOwner(senderJid(quoted))) {
    return sendText(chatId, 'Esse comando é só para dono do bot.', quoted);
  }

  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;

  const protectedOwners = ownerNumbers();
  const targets = [];
  for (const participant of meta.participants || []) {
    const raw = normalizeJid(participant.id || participant.phoneNumber || participant.lid);
    if (!raw || isBotParticipant(raw)) continue;
    const ids = [
      raw,
      participant.id,
      participant.lid,
      participant.phoneNumber
    ].map(onlyDigits).filter(Boolean);
    const isProtectedOwner = ids.some((digits) => protectedOwners.some((owner) => owner === digits || digits.endsWith(owner)));
    if (isProtectedOwner) continue;
    const actionJid = participantActionJid(meta, raw);
    if (actionJid && !targets.some((old) => sameParticipant(old, actionJid))) targets.push(actionJid);
  }

  if (!targets.length) return sendText(chatId, 'Não achei membros removíveis. Dono e bot ficam protegidos.', quoted);

  await sendText(chatId, `Arquivamento iniciado: ${targets.length} membro(s) na fila de remoção.`, quoted);
  groupExitAudioSuppressedUntil.set(chatId, Date.now() + 180000);
  await sendDiscordLog('Arquivamento de grupo iniciado', `${meta.subject || shortJid(chatId)} entrou em modo arquivar.`, [
    { name: 'Grupo', value: meta.subject || shortJid(chatId), inline: true },
    { name: 'Membros na fila', value: String(targets.length), inline: true },
    { name: 'Solicitante', value: shortJid(senderJid(quoted)), inline: true }
  ], 0xef4444);

  let removed = 0;
  let failed = 0;
  for (const batch of chunkArray(targets, 8)) {
    try {
      await sock.groupParticipantsUpdate(chatId, batch, 'remove');
      removed += batch.length;
    } catch (error) {
      debugLog('ARCHIVE_GROUP_BATCH_FAIL', { chat: shortJid(chatId), size: batch.length, error: error?.message || String(error) });
      for (const target of batch) {
        try {
          await sock.groupParticipantsUpdate(chatId, [target], 'remove');
          removed += 1;
        } catch (itemError) {
          failed += 1;
          debugLog('ARCHIVE_GROUP_ITEM_FAIL', { chat: shortJid(chatId), target: shortJid(target), error: itemError?.message || String(itemError) });
        }
        await sleep(600);
      }
    }
    await sleep(1200);
  }

  await sendDiscordLog('Arquivamento de grupo concluído', `${meta.subject || shortJid(chatId)} finalizado.`, [
    { name: 'Removidos', value: String(removed), inline: true },
    { name: 'Falhas', value: String(failed), inline: true },
    { name: 'Protegidos', value: 'bot e donos', inline: true }
  ], failed ? 0xf59e0b : 0x22c55e);

  void sendDiscordGroupsSnapshot('arquivamento de grupo').catch((error) => debugLog('DISCORD_GROUP_SNAPSHOT_FAIL', { error: error?.message || String(error) }));
  return sendText(chatId, `Arquivamento concluído.\nRemovidos: ${removed}\nFalhas: ${failed}`, quoted);
}

async function warnCommand(chatId, args, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, 'Marque ou responda quem vai levar advertência.', quoted);
  const count = addWarningEvent(chatId, target, senderJid(quoted), args || 'sem motivo');
  const mention = mentionFromParticipant(findParticipant(meta, target), target);
  await sendModerationCard(chatId, 'ADVERTENCIA', displayNameForCard(chatId, target, meta, quoted, mention), `Motivo: ${args || 'sem motivo'} | Total: ${count}`, [mention.jid], quoted, 'warnCard', target);
}

async function clearWarningsCommand(chatId, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, 'Marque ou responda quem vai ter as advertencias limpas.', quoted);
  clearWarnings(chatId, target);
  const mention = mentionFromParticipant(findParticipant(meta, target), target);
  await sendModerationCard(chatId, 'ADVERTENCIAS LIMPAS', displayNameForCard(chatId, target, meta, quoted, mention), 'Advertencias zeradas.', [mention.jid], quoted, 'clearWarnCard', target);
}

async function listWarningsCommand(chatId, quoted) {
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted);
  if (target) {
    const mention = mentionFromParticipant(findParticipant(meta, target), target);
    const count = getWarningCount(chatId, target);
    return sendModerationCard(chatId, 'ADVERTENCIAS', displayNameForCard(chatId, target, meta, quoted, mention), `Total registrado: ${count}`, [mention.jid], quoted, 'listWarnCard', target);
  }
  const rows = meta.participants
    .map((participant, index) => {
      const count = getWarningCount(chatId, participant.id);
      const mention = mentionFromParticipant(participant, participant.id);
      return count > 0 ? `${index + 1}. ${mention.text} - ${count}` : '';
    })
    .filter(Boolean)
    .slice(0, 12);
  if (!rows.length) return sendText(chatId, 'Nenhuma advertencia ativa. A arquivo esta limpa.', quoted);
  return sendText(chatId, ['*Advertencias do Cleiton*', '', ...rows].join('\n'), quoted);
}

async function memberMuteIds(meta, target) {
  const participant = findParticipant(meta, target);
  const mappedPn = await pnForJid(participant?.phoneNumber || participant?.id || participant?.lid || target).catch(() => null);
  const ids = [
    target,
    mappedPn,
    participant?.id,
    participant?.lid,
    participant?.phoneNumber
  ].map(normalizeJid).filter(Boolean);
  const unique = [];
  for (const jid of ids) {
    if (!unique.some((old) => sameParticipant(old, jid))) unique.push(jid);
  }
  return unique;
}

function parseMuteMinutes(args = '') {
  const fallback = Number(getSetting('AUTO_MUTE_MINUTES', '10')) || 10;
  const text = String(args || '').replace(/@\S+/g, ' ').trim();
  const match = text.match(/(?:^|\s)(\d{1,4})\s*(s|seg|segundos?|m|min|minutos?|h|horas?|d|dias?)?\b/i);
  if (!match) return fallback;
  const value = Math.max(1, Number(match[1]) || fallback);
  const unit = String(match[2] || 'm').toLowerCase();
  if (unit.startsWith('s')) return Math.max(1, Math.ceil(value / 60));
  if (unit.startsWith('h')) return Math.min(value * 60, 10080);
  if (unit.startsWith('d')) return Math.min(value * 1440, 10080);
  return Math.min(value, 10080);
}

async function activeMuteFor(chatId, target, meta) {
  const ids = await memberMuteIds(meta, target);
  for (const jid of ids) {
    const mute = getActiveMute(chatId, jid);
    if (mute) return { ...mute, matchedId: jid, ids };
  }
  return null;
}

async function deleteMessageKey(chatId, message, label = 'deleteMessage') {
  try {
    await sock.sendMessage(chatId, {
      delete: {
        remoteJid: chatId,
        fromMe: Boolean(message.key.fromMe),
        id: message.key.id,
        participant: message.key.participant || senderJid(message)
      }
    });
    debugLog('DELETE_OK', { label, chat: shortJid(chatId), id: message.key.id });
    return true;
  } catch (error) {
    debugLog('DELETE_FAIL', { label, chat: shortJid(chatId), id: message.key.id, error: error?.message || String(error) });
    return false;
  }
}

async function enforceMuteIfNeeded(chatId, sender, message, meta) {
  const mute = await activeMuteFor(chatId, sender, meta);
  if (!mute) return false;
  debugLog('MUTE_ENFORCE', {
    chat: shortJid(chatId),
    sender: shortJid(sender),
    matched: shortJid(mute.matchedId),
    until: mute.until_ts
  });
  await deleteMessageKey(chatId, message, 'muteEnforce');
  const key = `${chatId}:${mute.matchedId}`;
  const now = Date.now();
  if ((muteNoticeCooldown.get(key) || 0) < now) {
    muteNoticeCooldown.set(key, now + 30000);
    const mention = await mentionFor(chatId, sender, meta);
    await sendMentionText(chatId, `${mention.text} esta em mute. Mensagem recolhida pelo chat.`, [mention.jid], message);
  }
  return true;
}

async function enforceAutoModeration(chatId, sender, message, meta) {
  if (!meta) return false;
  if (await isModeratorExempt(meta, sender)) return false;
  const body = extractText(message);

  if (chatBoolSetting(chatId, 'ANTITRAVA_ENABLED')) {
    const trava = antiTravaReason(chatId, message, body);
    if (trava) {
      const minutes = Math.max(1, Math.min(Number(getSetting('ANTITRAVA_MUTE_MINUTES', defaults.ANTITRAVA_MUTE_MINUTES)) || 10, 1440));
      const untilTs = Math.floor(Date.now() / 1000) + minutes * 60;
      const ids = await memberMuteIds(meta, sender);
      for (const id of ids) muteUser(chatId, id, untilTs, `antitrava: ${trava.reason}`);
      await autoModerationStrike(chatId, sender, message, meta, 'ANTI-TRAVA', `${trava.label}. Mute de ${minutes} min aplicado.`, 'antiTrava');
      await sendAntiTravaRecovery(chatId, trava.label);
      return true;
    }
  }

  if (chatBoolSetting(chatId, 'ANTILINK_ENABLED') && hasLink(body) && !isLinkAllowed(chatId, sender, meta)) {
    await autoModerationStrike(chatId, sender, message, meta, 'LINK BLOQUEADO', 'Somente admin ou whitelist manda link por aqui.', 'autoLink');
    return true;
  }

  const blockedWord = chatBoolSetting(chatId, 'ANTIPALAVRA_ENABLED') ? blockedWordInText(chatId, body) : '';
  if (blockedWord) {
    await autoModerationStrike(chatId, sender, message, meta, 'PALAVRA BLOQUEADA', `Termo barrado: ${blockedWord}`, 'autoWord');
    return true;
  }

  if (chatBoolSetting(chatId, 'ANTIFLOOD_ENABLED') && isFlooding(chatId, sender)) {
    const minutes = Math.max(1, Math.min(Number(getSetting('AUTO_MUTE_MINUTES', '5')) || 5, 60));
    const untilTs = Math.floor(Date.now() / 1000) + minutes * 60;
    const ids = await memberMuteIds(meta, sender);
    for (const id of ids) muteUser(chatId, id, untilTs, 'antiflood automatico');
    await autoModerationStrike(chatId, sender, message, meta, 'FLOOD BLOQUEADO', `${minutes} minuto(s) em pausa para esfriar o teclado.`, 'autoFlood');
    await sendAntiTravaRecovery(chatId, 'Flood em massa detectado');
    return true;
  }

  return false;
}

function antiTravaReason(chatId, message, body = '') {
  const text = String(body || '');
  const maxText = chatNumberSetting(chatId, 'ANTITRAVA_MAX_TEXT_LENGTH', defaults.ANTITRAVA_MAX_TEXT_LENGTH, 1000, 20000);
  const maxPayloadKb = chatNumberSetting(chatId, 'ANTITRAVA_MAX_PAYLOAD_KB', defaults.ANTITRAVA_MAX_PAYLOAD_KB, 50, 1500);
  const maxMediaMb = chatNumberSetting(chatId, 'ANTITRAVA_MAX_MEDIA_MB', defaults.ANTITRAVA_MAX_MEDIA_MB, 1, 2048);
  const maxInvisible = chatNumberSetting(chatId, 'ANTITRAVA_MAX_INVISIBLE_CHARS', defaults.ANTITRAVA_MAX_INVISIBLE_CHARS, 20, 2000);
  const maxLineBreaks = chatNumberSetting(chatId, 'ANTITRAVA_MAX_LINE_BREAKS', defaults.ANTITRAVA_MAX_LINE_BREAKS, 30, 2000);
  const maxMentions = chatNumberSetting(chatId, 'ANTITRAVA_MAX_MENTIONS', defaults.ANTITRAVA_MAX_MENTIONS, 5, 200);
  const payloadKb = Math.ceil(Buffer.byteLength(safeStringifyMessage(message.message), 'utf8') / 1024);
  const mediaMb = messageMediaSizeMb(message);
  const mentions = mentionedJids(message).length;
  const invisible = (text.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g) || []).length;
  const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) || []).length;
  const lineBreaks = (text.match(/\n/g) || []).length;
  const repeatedRun = longestRepeatedRun(text);

  if (payloadKb > maxPayloadKb) return { reason: 'payload', label: `Mensagem pesada demais (${payloadKb}KB)` };
  if (mediaMb > maxMediaMb) return { reason: 'media_size', label: `Arquivo pesado demais (${mediaMb.toFixed(1)}MB)` };
  if (text.length > maxText) return { reason: 'text_length', label: `Texto grande demais (${text.length} caracteres)` };
  if (invisible > maxInvisible) return { reason: 'invisible_chars', label: `Caracteres invisiveis em excesso (${invisible})` };
  if (controls > 12) return { reason: 'control_chars', label: `Caracteres suspeitos em excesso (${controls})` };
  if (lineBreaks > maxLineBreaks) return { reason: 'line_breaks', label: `Quebras de linha em excesso (${lineBreaks})` };
  if (mentions > maxMentions) return { reason: 'mentions', label: `Mencoes em excesso (${mentions})` };
  if (repeatedRun > 900) return { reason: 'repeated_chars', label: `Repeticao suspeita (${repeatedRun}x)` };
  return null;
}

function safeStringifyMessage(message = {}) {
  try {
    return JSON.stringify(message || {});
  } catch {
    return '';
  }
}

function messageMediaSizeMb(message = {}) {
  const msg = message.message || {};
  const candidates = [
    msg.imageMessage,
    msg.videoMessage,
    msg.audioMessage,
    msg.documentMessage,
    msg.stickerMessage
  ].filter(Boolean);
  let maxBytes = 0;
  for (const media of candidates) {
    const raw = Number(media.fileLength?.low ?? media.fileLength ?? media.fileSize ?? 0);
    if (Number.isFinite(raw) && raw > maxBytes) maxBytes = raw;
  }
  return maxBytes / 1024 / 1024;
}

async function sendAntiTravaRecovery(chatId, reason = '') {
  const now = Date.now();
  const cooldownSeconds = Math.max(20, Math.min(
    chatNumberSetting(chatId, 'ANTITRAVA_RECOVERY_COOLDOWN_SECONDS', defaults.ANTITRAVA_RECOVERY_COOLDOWN_SECONDS, 20, 600),
    600
  ));
  if ((antiTravaRecoveryCooldown.get(chatId) || 0) > now) {
    debugLog('ANTITRAVA_RECOVERY_COOLDOWN', { chat: shortJid(chatId), reason: compactText(reason) });
    return false;
  }
  antiTravaRecoveryCooldown.set(chatId, now + cooldownSeconds * 1000);
  const text = [
    'Destrava acionado pelo Cleiton.',
    ...Array(8).fill(''),
    'Conteúdo suspeito removido e autor em pausa.',
    reason ? `Motivo: ${reason}` : ''
  ].filter((line, index, list) => line || index < list.length - 1).join('\n');
  return Boolean(await safeSendMessage(chatId, { text }, undefined, 'antiTravaRecovery'));
}

function longestRepeatedRun(text = '') {
  let longest = 0;
  let current = 0;
  let previous = '';
  for (const char of String(text || '')) {
    if (char === previous) {
      current += 1;
    } else {
      previous = char;
      current = 1;
    }
    if (current > longest) longest = current;
  }
  return longest;
}

function chatNumberSetting(chatId, key, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(getChatSetting(chatId, key, fallback));
  if (!Number.isFinite(value)) return Number(fallback) || min;
  return Math.max(min, Math.min(value, max));
}

async function isModeratorExempt(meta, sender) {
  const actor = findParticipant(meta, sender);
  return Boolean(
    actor?.admin
    || await isOwner(sender)
    || await isOwner(actor?.phoneNumber)
    || await isOwner(actor?.id)
    || await isOwner(actor?.lid)
  );
}

function moderationIds(meta, jid = '') {
  const participant = findParticipant(meta, jid);
  return [
    jid,
    participant?.id,
    participant?.lid,
    participant?.phoneNumber
  ].map(normalizeJid).filter(Boolean);
}

function isLinkAllowed(chatId, sender, meta) {
  return moderationIds(meta, sender).some((jid) => isLinkWhitelisted(chatId, jid));
}

function hasLink(text = '') {
  return /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|discord\.gg\/|(?:^|\s)[a-z0-9-]+\.(?:com|net|org|br|gg|io|me|app|dev|link|shop|store|xyz)(?:\/|\s|$))/i.test(String(text || ''));
}

function normalizeModerationText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function blockedWordInText(chatId, text = '') {
  const cleanText = normalizeModerationText(text);
  if (!cleanText) return '';
  const words = listBlockedWords(chatId);
  for (const row of words) {
    const cleanWord = normalizeModerationText(row.word);
    if (!cleanWord) continue;
    const matched = cleanWord.includes(' ')
      ? cleanText.includes(cleanWord)
      : new RegExp(`(^|[^a-z0-9_])${escapeRegExp(cleanWord)}([^a-z0-9_]|$)`, 'i').test(cleanText);
    if (matched) return row.word;
  }
  return '';
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFlooding(chatId, sender) {
  const limit = Math.max(3, Number(getSetting('ANTIFLOOD_LIMIT', defaults.ANTIFLOOD_LIMIT)) || 6);
  const windowMs = Math.max(3000, (Number(getSetting('ANTIFLOOD_WINDOW_SECONDS', defaults.ANTIFLOOD_WINDOW_SECONDS)) || 8) * 1000);
  const key = `${chatId}:${normalizeJid(sender)}`;
  const now = Date.now();
  const window = (floodWindows.get(key) || []).filter((stamp) => now - stamp <= windowMs);
  window.push(now);
  floodWindows.set(key, window);
  return window.length > limit;
}

async function autoModerationStrike(chatId, sender, message, meta, title, detail, label) {
  await deleteMessageKey(chatId, message, label);
  const cooldownKey = `${chatId}:${sender}:${label}`;
  const now = Date.now();
  if ((autoModNoticeCooldown.get(cooldownKey) || 0) > now) return;
  autoModNoticeCooldown.set(cooldownKey, now + 20000);
  const mention = await mentionFor(chatId, sender, meta);
  debugLog('AUTO_MOD_STRIKE', {
    chat: shortJid(chatId),
    sender: shortJid(sender),
    title,
    detail: compactText(detail)
  });
  await sendModerationCard(chatId, title, displayNameForCard(chatId, sender, meta, message, mention), detail, [mention.jid], message, label, sender);
}

async function autoModerationToggleCommand(chatId, key, args, quoted, title) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const value = normalizeToggle(args) || (chatBoolSetting(chatId, key) ? 'false' : 'true');
  setChatSetting(chatId, key, value);
  const label = value === 'true' ? 'LIGADO' : 'DESLIGADO';
  await sendModerationCard(chatId, title, label, `${title.toLowerCase()} ${value === 'true' ? 'ativo' : 'pausado'} neste grupo.`, [], quoted, `${key}Card`);
}

async function antiTravaCommand(chatId, args, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  const action = (parts[0] || '').toLowerCase();
  const toggle = normalizeToggle(action);

  if (!action || toggle) {
    const value = toggle || (chatBoolSetting(chatId, 'ANTITRAVA_ENABLED') ? 'false' : 'true');
    setChatSetting(chatId, 'ANTITRAVA_ENABLED', value);
    return sendModerationCard(
      chatId,
      'ANTI-TRAVA',
      value === 'true' ? 'LIGADO' : 'DESLIGADO',
      value === 'true' ? 'Protecao contra trava ativa.' : 'Protecao contra trava pausada.',
      [],
      quoted,
      'antiTravaToggleCard'
    );
  }

  if (['status', 'config', 'ver'].includes(action)) {
    return sendText(chatId, antiTravaStatusText(chatId), quoted);
  }

  const settingMap = {
    texto: 'ANTITRAVA_MAX_TEXT_LENGTH',
    text: 'ANTITRAVA_MAX_TEXT_LENGTH',
    payload: 'ANTITRAVA_MAX_PAYLOAD_KB',
    kb: 'ANTITRAVA_MAX_PAYLOAD_KB',
    midia: 'ANTITRAVA_MAX_MEDIA_MB',
    media: 'ANTITRAVA_MAX_MEDIA_MB',
    arquivo: 'ANTITRAVA_MAX_MEDIA_MB',
    invisivel: 'ANTITRAVA_MAX_INVISIBLE_CHARS',
    invisiveis: 'ANTITRAVA_MAX_INVISIBLE_CHARS',
    linhas: 'ANTITRAVA_MAX_LINE_BREAKS',
    mencoes: 'ANTITRAVA_MAX_MENTIONS',
    mentions: 'ANTITRAVA_MAX_MENTIONS',
    mute: 'ANTITRAVA_MUTE_MINUTES',
    destrava: 'ANTITRAVA_RECOVERY_COOLDOWN_SECONDS',
    recovery: 'ANTITRAVA_RECOVERY_COOLDOWN_SECONDS',
    recuperacao: 'ANTITRAVA_RECOVERY_COOLDOWN_SECONDS',
    cooldown: 'ANTITRAVA_RECOVERY_COOLDOWN_SECONDS'
  };
  const key = settingMap[action];
  const value = Number(parts[1]);
  if (key && Number.isFinite(value) && value > 0) {
    setChatSetting(chatId, key, String(Math.floor(value)));
    return sendText(chatId, `Anti-trava atualizado: ${action} = ${Math.floor(value)}.`, quoted);
  }

  return sendText(chatId, [
    `Use ${prefix()}antitrava on/off`,
    `${prefix()}antitrava status`,
    `${prefix()}antitrava texto 3500`,
    `${prefix()}antitrava payload 220`,
    `${prefix()}antitrava midia 45`,
    `${prefix()}antitrava invisivel 180`,
    `${prefix()}antitrava linhas 160`,
    `${prefix()}antitrava mencoes 25`,
    `${prefix()}antitrava mute 10`,
    `${prefix()}antitrava destrava 90`
  ].join('\n'), quoted);
}

function antiTravaStatusText(chatId) {
  return [
    '*Anti-trava*',
    '',
    `Status: ${chatBoolSetting(chatId, 'ANTITRAVA_ENABLED') ? 'ligado' : 'desligado'}`,
    `Texto maximo: ${chatNumberSetting(chatId, 'ANTITRAVA_MAX_TEXT_LENGTH', defaults.ANTITRAVA_MAX_TEXT_LENGTH)} caracteres`,
    `Payload maximo: ${chatNumberSetting(chatId, 'ANTITRAVA_MAX_PAYLOAD_KB', defaults.ANTITRAVA_MAX_PAYLOAD_KB)} KB`,
    `Midia maxima: ${chatNumberSetting(chatId, 'ANTITRAVA_MAX_MEDIA_MB', defaults.ANTITRAVA_MAX_MEDIA_MB)} MB`,
    `Invisiveis maximos: ${chatNumberSetting(chatId, 'ANTITRAVA_MAX_INVISIBLE_CHARS', defaults.ANTITRAVA_MAX_INVISIBLE_CHARS)}`,
    `Linhas maximas: ${chatNumberSetting(chatId, 'ANTITRAVA_MAX_LINE_BREAKS', defaults.ANTITRAVA_MAX_LINE_BREAKS)}`,
    `Mencoes maximas: ${chatNumberSetting(chatId, 'ANTITRAVA_MAX_MENTIONS', defaults.ANTITRAVA_MAX_MENTIONS)}`,
    `Mute: ${chatNumberSetting(chatId, 'ANTITRAVA_MUTE_MINUTES', defaults.ANTITRAVA_MUTE_MINUTES)} min`,
    `Cooldown destrava: ${chatNumberSetting(chatId, 'ANTITRAVA_RECOVERY_COOLDOWN_SECONDS', defaults.ANTITRAVA_RECOVERY_COOLDOWN_SECONDS)} s`
  ].join('\n');
}

async function whitelistLinkCommand(chatId, args, quoted) {
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const action = String(args || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (!args || ['list', 'lista', 'ver'].includes(action)) {
    const rows = listLinkWhitelist(chatId);
    if (!rows.length) return sendText(chatId, 'Whitelist de link vazia. So admins podem mandar link agora.', quoted);
    const mentions = await Promise.all(rows.slice(0, 20).map((row) => mentionFor(chatId, row.user_id, meta)));
    const text = ['*Whitelist de link*', '', ...mentions.map((item, index) => `${index + 1}. ${item.text}`)].join('\n');
    return sendMentionText(chatId, text, mentions.map((item) => item.jid), quoted);
  }
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, `Use ${prefix()}whitelistlink @pessoa ou ${prefix()}whitelistlink del @pessoa.`, quoted);
  const ids = moderationIds(meta, target);
  const remove = ['del', 'remover', 'remove', 'tirar'].includes(action);
  for (const id of ids) {
    if (remove) removeLinkWhitelist(chatId, id);
    else addLinkWhitelist(chatId, id, senderJid(quoted));
  }
  const mention = await mentionFor(chatId, target, meta);
  await sendModerationCard(
    chatId,
    remove ? 'WHITELIST REMOVIDA' : 'WHITELIST LINK',
    displayNameForCard(chatId, target, meta, quoted, mention),
    remove ? 'Permissao de link removida.' : 'Pode mandar link mesmo sem cargo de admin.',
    [mention.jid],
    quoted,
    'whitelistLinkCard',
    target
  );
}

async function antiWordCommand(chatId, args, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  const action = parts[0]?.toLowerCase() || '';
  if (!action) {
    const value = chatBoolSetting(chatId, 'ANTIPALAVRA_ENABLED') ? 'false' : 'true';
    setChatSetting(chatId, 'ANTIPALAVRA_ENABLED', value);
    return sendModerationCard(chatId, 'ANTIPALAVRA', value === 'true' ? 'LIGADO' : 'DESLIGADO', 'Filtro de palavras atualizado.', [], quoted, 'antiWordToggleCard');
  }
  const toggle = normalizeToggle(action);
  if (toggle) {
    setChatSetting(chatId, 'ANTIPALAVRA_ENABLED', toggle);
    return sendModerationCard(chatId, 'ANTIPALAVRA', toggle === 'true' ? 'LIGADO' : 'DESLIGADO', 'Filtro de palavras atualizado.', [], quoted, 'antiWordToggleCard');
  }
  if (['list', 'lista', 'ver'].includes(action)) {
    const rows = listBlockedWords(chatId);
    return sendText(chatId, rows.length
      ? ['*Palavras bloqueadas*', '', ...rows.map((row, index) => `${index + 1}. ${row.word}`)].join('\n')
      : 'Nenhuma palavra bloqueada cadastrada.', quoted);
  }
  const word = ['add', 'adicionar', 'del', 'remover', 'remove', 'tirar'].includes(action)
    ? parts.slice(1).join(' ').trim()
    : parts.join(' ').trim();
  if (!word) return sendText(chatId, `Use ${prefix()}antipalavra add palavra, ${prefix()}antipalavra del palavra ou ${prefix()}antipalavra on/off.`, quoted);
  const remove = ['del', 'remover', 'remove', 'tirar'].includes(action);
  if (remove) removeBlockedWord(chatId, word);
  else addBlockedWord(chatId, word, senderJid(quoted));
  await sendModerationCard(
    chatId,
    remove ? 'PALAVRA LIBERADA' : 'PALAVRA BLOQUEADA',
    truncateText(word, 28),
    remove ? 'Termo saiu da lista restritiva.' : 'Termo entrou na lista restritiva.',
    [],
    quoted,
    'antiWordCard'
  );
}

async function muteCommand(chatId, args, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, 'Marque ou responda quem vai ficar em pausa.', quoted);
  const minutes = parseMuteMinutes(args);
  const untilTs = Math.floor(Date.now() / 1000) + minutes * 60;
  const ids = await memberMuteIds(meta, target);
  for (const id of ids) muteUser(chatId, id, untilTs, 'mute manual');
  debugLog('MUTE_SET', {
    chat: shortJid(chatId),
    target: shortJid(target),
    ids: ids.map(shortJid).join(','),
    minutes
  });
  const mention = await mentionFor(chatId, target, meta);
  await sendModerationCard(chatId, 'MUTE ATIVO', displayNameForCard(chatId, target, meta, quoted, mention), `${minutes} minuto(s) em pausa protocolar.`, [mention.jid], quoted, 'muteCard', target);
}

async function unmuteCommand(chatId, quoted) {
  const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const target = targetJid(quoted);
  if (!target) return sendText(chatId, 'Marque ou responda quem vai sair do mute.', quoted);
  const ids = await memberMuteIds(meta, target);
  for (const id of ids) unmuteUser(chatId, id);
  debugLog('MUTE_CLEAR', { chat: shortJid(chatId), target: shortJid(target), ids: ids.map(shortJid).join(',') });
  const mention = await mentionFor(chatId, target, meta);
  await sendModerationCard(chatId, 'DESMUTE', displayNameForCard(chatId, target, meta, quoted, mention), 'Pausa removida. Pode falar no chat de novo.', [mention.jid], quoted, 'unmuteCard', target);
}

async function ownerToggle(chatId, key, args, quoted) {
  if (!await isOwner(senderJid(quoted))) return sendText(chatId, 'Esse botão é só do dono do chat.', quoted);
  const value = normalizeToggle(args);
  if (!value) return sendText(chatId, `${key}: ${onOff(key)}. Use on/off.`, quoted);
  setSetting(key, value);
  await sendText(chatId, `${key} agora está ${value === 'true' ? 'ligado' : 'desligado'}.`, quoted);
}

async function adminToggle(chatId, key, args, quoted, label = key) {
  const meta = await requireActorAdmin(chatId, senderJid(quoted), quoted);
  if (!meta) return;
  const value = normalizeToggle(args) || (boolSetting(key) ? 'false' : 'true');
  setSetting(key, value);
  await sendText(chatId, `${label} agora está ${value === 'true' ? 'ligado' : 'desligado'}. Cleiton ajustou a câmera do Cleiton.`, quoted);
}

async function configCommand(chatId, args, quoted) {
  if (!await isOwner(senderJid(quoted))) return sendText(chatId, 'Configuração é só com o dono do Cleiton.', quoted);
  const [key, ...rest] = args.split(/\s+/);
  const value = rest.join(' ').trim();
  if (!key || !value) return sendText(chatId, `Use: ${prefix()}config CHAVE valor`, quoted);
  setSetting(key.toUpperCase(), value);
  await sendText(chatId, `Configuração salva: ${key.toUpperCase()} = ${value}`, quoted);
}

async function clearTmpCommand(chatId, quoted) {
  cleanTemp();
  await sendText(chatId, 'Temp limpo. Cleiton passou o rodo no corredor.', quoted);
}

async function catalogFallback(chatId, command, args, quoted) {
  const category = getCommandCategory(command);
  if (command === 'perfil' || command === 'profile' || command === 'meustatus') return profileCommand(chatId, args, quoted);
  if (category === 'menudown') return downloadCommand(chatId, args, command.includes('vid') ? 'video' : 'audio', quoted);
  if (['ttp', 'attp'].includes(command)) return textStickerCommand(chatId, command, args, quoted);
  if (category === 'menufig') return stickerCommand(chatId, quoted);
  if (category === 'menuia') return sendText(chatId, shortCleitonAnswer(args || command), quoted);
  await sendText(chatId, `Registro ${prefix()}${command} recebido no motor Knight do Cleiton.`, quoted);
}

async function knightExtraCommand(chatId, command, args, quoted) {
  if (command === '__removed_piada') {
    return sendText(chatId, 'Piada registrada: o grupo perguntou se eu era barato. Eu respondi: barato é o aluguel desse chat.', quoted);
  }
  if (command === '__removed_fato') {
    return sendText(chatId, 'Fato do Cleiton: quem le as regras evita confusao desnecessaria.', quoted);
  }
  if (['__removed_quote', '__removed_frase'].includes(command)) {
    return sendText(chatId, '“Humildade no grupo e print no arquivo.” — Cleiton, setor de ocorrências pequenas.', quoted);
  }
  if (command === '__removed_verdade') {
    return sendText(chatId, 'Verdade: qual foi a última mensagem que você quase mandou e apagou com medo do X9?', quoted);
  }
  if (command === '__removed_desafio') {
    return sendText(chatId, 'Desafio: elogie alguém do grupo sem parecer que está devendo dinheiro.', quoted);
  }
  if (command === '__removed_bola8') {
    return sendText(chatId, stablePercent(args || chatId) > 49 ? 'A bola 8 do Cleiton disse: sim, mas protocole com calma.' : 'A bola 8 caiu da mesa e disse: melhor não.', quoted);
  }
  if (command === '__removed_casal_text') {
    return sendText(chatId, `Compatibilidade registrada: ${stablePercent(args || chatId)}%. Cleiton não julga, só arquiva.`, quoted);
  }
  if (command === '__removed_elogio') {
    return sendText(chatId, 'Elogio oficial: sua presença no grupo está tão organizada que até minha prancheta ficou emocionada.', quoted);
  }
  if (command === '__removed_zoar') {
    return sendText(chatId, 'Zoacao leve: voce esta mais perdido que figurinha sem contexto. Mas ainda da para salvar.', quoted);
  }
  if (command === '__removed_cantada') return sendText(chatId, randomItem(cleitonFlirts), quoted);
  if (command === '__removed_meme') return sendText(chatId, randomItem(cleitonMemes), quoted);
  if (command === '__removed_simp') return mentionGameText(chatId, quoted, 'Relatorio simp', 'foi confirmado como simp nivel');
  if (command === 'wasted') return mentionGameText(chatId, quoted, 'Wasted do Cleiton', 'foi encontrado caido no corredor do Cleiton com');
  if (command === '__removed_character') return characterGame(chatId, quoted);
  if (command === '__removed_forca') return hangmanCommand(chatId, args, quoted);
  if (command === '__removed_trivia') return triviaCommand(chatId, args, quoted);
  if (command === '__removed_responder_text') return triviaAnswerCommand(chatId, args, quoted);
  if (command === 'tag') {
    const target = targetJid(quoted);
    if (!target) return sendText(chatId, 'Marque alguém ou responda uma mensagem para eu chamar.', quoted);
    const mention = await mentionFor(chatId, target);
    return sendMentionText(chatId, `Chamando ${mention.text} no chat.`, [mention.jid], quoted);
  }
  if (command === 'staff') {
    const meta = await sock.groupMetadata(chatId);
    const admins = meta.participants.filter((p) => p.admin).map((p) => mentionFromParticipant(p));
    return sock.sendMessage(chatId, { text: `*Staff do grupo*\n\n${admins.map((item) => item.text).join('\n') || 'Sem admins no cadastro.'}`, mentions: admins.map((item) => item.jid) }, { quoted });
  }
  if (command === 'groupinfo') {
    const meta = await sock.groupMetadata(chatId);
    return sendText(chatId, `*Info do grupo*\nNome: ${meta.subject}\nMembros: ${meta.participants.length}\nID: ${chatId}`, quoted);
  }
  if (command === 'linkgp') {
    const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
    if (!meta) return;
    const code = await sock.groupInviteCode(chatId);
    return sendText(chatId, `Link do grupo:\nhttps://chat.whatsapp.com/${code}`, quoted);
  }
  if (command === 'resetlink') {
    const meta = await requireGroupAdmin(chatId, senderJid(quoted), quoted);
    if (!meta) return;
    await sock.groupRevokeInvite(chatId);
    return sendText(chatId, 'Link resetado. Cleiton trocou a fechadura do chat.', quoted);
  }
  if (command === 'tts') {
    return sendText(chatId, 'TTS entrou na lista do motor Knight. Vou deixar voz real no próximo pacote.', quoted);
  }
  if (['simage', 'toimg'].includes(command)) {
    return sendText(chatId, 'Conversão de sticker para imagem entrou no motor novo. Para sticker normal, use !sticker.', quoted);
  }
}

async function mentionGameText(chatId, quoted, title, phrase) {
  const target = targetJid(quoted) || senderJid(quoted);
  const mention = await mentionFor(chatId, target);
  const percent = stablePercent(`${title}:${target}:${Date.now()}`);
  return sendMentionText(chatId, `*${title}*\n\n${mention.text} ${phrase} ${percent}%. Cleiton nao julga, so protocola.`, [mention.jid], quoted);
}

async function characterGame(chatId, quoted) {
  const target = targetJid(quoted) || senderJid(quoted);
  const mention = await mentionFor(chatId, target);
  const traits = ['resenha', 'caos controlado', 'humildade', 'perigo no teclado', 'energia de adm', 'sumico estrategico', 'talento suspeito'];
  const picked = shuffle(traits, target).slice(0, 4).map((trait) => `- ${trait}: ${40 + stablePercent(`${target}:${trait}`) % 61}%`);
  return sendMentionText(chatId, [`*Analise de personagem do Cleiton*`, '', `${mention.text} foi avaliado no chat:`, ...picked].join('\n'), [mention.jid], quoted);
}

async function hangmanCommand(chatId, args, quoted) {
  const letter = args.trim().toLowerCase();
  const words = ['cleiton', 'grupo', 'tropa', 'admin', 'sticker', 'musica'];
  let game = hangmanGames.get(chatId);
  if (!game || !letter) {
    const word = randomItem(words);
    game = { word, guessed: new Set(), wrong: 0 };
    hangmanGames.set(chatId, game);
    return sendText(chatId, `*Forca do Cleiton*\n\nPalavra: ${maskedWord(game)}\nUse ${prefix()}forca letra`, quoted);
  }
  const guess = letter[0];
  if (game.guessed.has(guess)) return sendText(chatId, `Essa letra ja esta no processo: ${guess}\n${maskedWord(game)}`, quoted);
  game.guessed.add(guess);
  if (!game.word.includes(guess)) game.wrong += 1;
  if (!maskedWord(game).includes('_')) {
    hangmanGames.delete(chatId);
    return sendText(chatId, `Acertou. A palavra era *${game.word}*. Cleiton bateu palmas com a prancheta.`, quoted);
  }
  if (game.wrong >= 6) {
    hangmanGames.delete(chatId);
    return sendText(chatId, `Fim de expediente. A palavra era *${game.word}*.`, quoted);
  }
  return sendText(chatId, `Palavra: ${maskedWord(game)}\nErros: ${game.wrong}/6`, quoted);
}

async function quizCommand(chatId, args, quoted) {
  const action = String(args || '').trim().toLowerCase();
  if (['tutorial', 'ajuda', 'help'].includes(action)) {
    return sendText(chatId, [
      '*Quiz do Cleiton*',
      '',
      `${prefix()}quiz - abre uma pergunta`,
      `${prefix()}responder 1 - responde pela opcao`,
      `${prefix()}dueloquiz @pessoa - desafia alguem em 3 rodadas`
    ].join('\n'), quoted);
  }
  const question = await fetchQuizQuestion();
  quizGames.set(chatId, {
    ...question,
    createdAt: Date.now(),
    starter: senderJid(quoted)
  });
  debugLog('QUIZ_START', { chat: shortJid(chatId), source: question.source, correct: question.correctIndex + 1 });
  const image = await quizCardBuffer({
    title: 'QUIZ DO CLEITON',
    badge: 'PERGUNTA ABERTA',
    question: question.question,
    options: question.options,
    footer: `Responda com ${prefix()}responder 1`
  });
  return safeSendMessage(chatId, {
    image,
    caption: quizQuestionCaption(question, '*Quiz aberto*')
  }, { quoted }, 'quizQuestion');
}

async function duelQuizCommand(chatId, args, quoted) {
  if (!chatId.endsWith('@g.us')) return sendText(chatId, 'Dueloquiz so funciona em grupo.', quoted);
  const meta = await sock.groupMetadata(chatId).catch(() => null);
  if (!meta) return sendText(chatId, 'Nao consegui abrir a lista do grupo agora.', quoted);
  const sender = roulettePlayerId(meta, senderJid(quoted));
  const cleanArgs = String(args || '').trim();
  const action = cleanArgs.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
  const game = duelQuizGames.get(chatId);

  if (['tutorial', 'ajuda', 'help', 'comojogar'].includes(action)) return duelQuizTutorialCommand(chatId, quoted);
  if (['cancelar', 'parar', 'sair'].includes(action)) return duelQuizCancelCommand(chatId, meta, quoted, game, sender);
  if (['aceitar', 'aceito', 'sim', 'iniciar'].includes(action)) return duelQuizAcceptCommand(chatId, meta, quoted, game, sender);
  if (['recusar', 'recuso', 'negar', 'nao'].includes(action)) return duelQuizRefuseCommand(chatId, meta, quoted, game, sender);

  if (game?.status === 'pending') {
    const challenger = await mentionFor(chatId, game.challenger, meta);
    const challenged = await mentionFor(chatId, game.challenged, meta);
    return sendMentionText(chatId, `Ja tem duelo aberto: ${challenger.text} x ${challenged.text}.`, [challenger.jid, challenged.jid], quoted);
  }
  if (game?.status === 'active') {
    return sendText(chatId, `Duelo em andamento. Jogadores respondem com ${prefix()}responder 1, 2, 3 ou 4.`, quoted);
  }

  const targetRaw = targetJid(quoted);
  if (!targetRaw) {
    return sendText(chatId, [
      `Use ${prefix()}dueloquiz @pessoa para abrir desafio.`,
      `Use ${prefix()}dueloquiz tutorial para ver as regras.`
    ].join('\n'), quoted);
  }
  const challenged = roulettePlayerId(meta, targetRaw);
  if (!challenged || !findParticipant(meta, challenged)) return sendText(chatId, 'Nao achei esse jogador no grupo.', quoted);
  if (sameParticipant(sender, challenged)) return sendText(chatId, 'Duelo contra o espelho nao faz sentido.', quoted);
  if (isBotParticipant(challenged)) return sendText(chatId, 'Cleiton apita o quiz, nao joga contra si mesmo.', quoted);

  const created = {
    status: 'pending',
    challenger: sender,
    challenged,
    round: 0,
    maxRounds: 3,
    scores: { [sender]: 0, [challenged]: 0 },
    currentQuestion: null,
    answers: {},
    createdAt: Date.now()
  };
  duelQuizGames.set(chatId, created);
  const challengerMention = await mentionFor(chatId, sender, meta);
  const challengedMention = await mentionFor(chatId, challenged, meta);
  const image = await duelQuizStatusCardBuffer({
    title: 'DUELOQUIZ',
    badge: 'DESAFIO ABERTO',
    status: 'aguardando aceite',
    left: challengerMention.text,
    right: challengedMention.text,
    leftScore: 0,
    rightScore: 0,
    round: 0,
    maxRounds: created.maxRounds,
    tone: 'pending'
  });
  const caption = [
    '*Dueloquiz do Cleiton*',
    '',
    `${challengerMention.text} desafiou ${challengedMention.text}`,
    `${challengedMention.text}: ${prefix()}dueloquiz aceitar`,
    `${challengedMention.text}: ${prefix()}dueloquiz recusar`
  ].join('\n');
  return safeSendMessage(chatId, {
    image,
    caption,
    mentions: [challengerMention.jid, challengedMention.jid].filter(Boolean)
  }, { quoted }, 'duelQuizChallenge');
}

async function duelQuizAcceptCommand(chatId, meta, quoted, game, sender) {
  if (!game || game.status !== 'pending') return sendText(chatId, 'Nao tem dueloquiz aguardando aceite.', quoted);
  if (!sameParticipant(sender, game.challenged)) {
    const challenged = await mentionFor(chatId, game.challenged, meta);
    return sendMentionText(chatId, `So ${challenged.text} pode aceitar esse duelo.`, [challenged.jid], quoted);
  }
  game.status = 'active';
  game.round = 1;
  game.currentQuestion = await fetchQuizQuestion();
  game.answers = {};
  duelQuizGames.set(chatId, game);
  debugLog('DUEL_QUIZ_ACCEPT', { chat: shortJid(chatId), challenger: shortJid(game.challenger), challenged: shortJid(game.challenged) });
  const challenger = await mentionFor(chatId, game.challenger, meta);
  const challenged = await mentionFor(chatId, game.challenged, meta);
  await sendMentionText(chatId, `*Dueloquiz iniciado*\n\n${challenger.text} x ${challenged.text}\nRodada 1/${game.maxRounds}`, [challenger.jid, challenged.jid], quoted);
  return sendDuelQuizQuestion(chatId, meta, game, quoted);
}

async function duelQuizRefuseCommand(chatId, meta, quoted, game, sender) {
  if (!game || game.status !== 'pending') return sendText(chatId, 'Nao tem dueloquiz aguardando resposta.', quoted);
  if (!sameParticipant(sender, game.challenged)) {
    const challenged = await mentionFor(chatId, game.challenged, meta);
    return sendMentionText(chatId, `So ${challenged.text} pode recusar esse duelo.`, [challenged.jid], quoted);
  }
  duelQuizGames.delete(chatId);
  const challenger = await mentionFor(chatId, game.challenger, meta);
  const challenged = await mentionFor(chatId, game.challenged, meta);
  const image = await duelQuizStatusCardBuffer({
    title: 'DUELO RECUSADO',
    badge: 'ARQUIVADO',
    status: 'sem quiz hoje',
    left: challenger.text,
    right: challenged.text,
    leftScore: 0,
    rightScore: 0,
    round: 0,
    maxRounds: game.maxRounds,
    tone: 'danger'
  });
  return safeSendMessage(chatId, {
    image,
    caption: `${challenged.text} recusou o duelo de ${challenger.text}.`,
    mentions: [challenger.jid, challenged.jid].filter(Boolean)
  }, { quoted }, 'duelQuizRefuse');
}

async function duelQuizCancelCommand(chatId, meta, quoted, game, sender) {
  if (!game) return sendText(chatId, 'Nao tem dueloquiz ativo para cancelar.', quoted);
  const actor = findParticipant(meta, sender);
  const allowed = await isOwner(sender)
    || actor?.admin
    || sameParticipant(sender, game.challenger)
    || sameParticipant(sender, game.challenged);
  if (!allowed) return sendText(chatId, 'So jogador do duelo ou admin cancela esse quiz.', quoted);
  duelQuizGames.delete(chatId);
  debugLog('DUEL_QUIZ_CANCEL', { chat: shortJid(chatId), by: shortJid(sender) });
  return sendText(chatId, 'Dueloquiz cancelado.', quoted);
}

async function duelQuizTutorialCommand(chatId, quoted) {
  const image = await duelQuizStatusCardBuffer({
    title: 'DUELOQUIZ',
    badge: 'COMO JOGAR',
    status: '3 rodadas no chat',
    left: 'Jogador 1',
    right: 'Jogador 2',
    leftScore: 0,
    rightScore: 0,
    round: 0,
    maxRounds: 3,
    tone: 'start'
  });
  const caption = [
    '*Tutorial do Dueloquiz*',
    '',
    `1. ${prefix()}dueloquiz @pessoa`,
    `2. ${prefix()}dueloquiz aceitar ou recusar`,
    `3. ${prefix()}responder 1, 2, 3 ou 4`,
    '4. Os dois respondem cada rodada',
    '5. Melhor pontuacao em 3 rodadas vence'
  ].join('\n');
  return safeSendMessage(chatId, { image, caption }, { quoted }, 'duelQuizTutorial');
}

async function sendDuelQuizQuestion(chatId, meta, game, quoted) {
  const challenger = await mentionFor(chatId, game.challenger, meta);
  const challenged = await mentionFor(chatId, game.challenged, meta);
  const image = await quizCardBuffer({
    title: 'DUELOQUIZ',
    badge: `RODADA ${game.round}/${game.maxRounds}`,
    question: game.currentQuestion.question,
    options: game.currentQuestion.options,
    footer: `${challenger.text} ${game.scores[game.challenger] || 0} x ${game.scores[game.challenged] || 0} ${challenged.text}`
  });
  return safeSendMessage(chatId, {
    image,
    caption: [
      `*Dueloquiz - rodada ${game.round}/${game.maxRounds}*`,
      '',
      `${challenger.text} e ${challenged.text}`,
      '',
      quizQuestionCaption(game.currentQuestion, '').trim()
    ].join('\n'),
    mentions: [challenger.jid, challenged.jid].filter(Boolean)
  }, { quoted }, 'duelQuizQuestion');
}

async function quizAnswerCommand(chatId, args, quoted) {
  const sender = senderJid(quoted);
  const duel = duelQuizGames.get(chatId);
  if (duel?.status === 'active' && (sameParticipant(sender, duel.challenger) || sameParticipant(sender, duel.challenged))) {
    return duelQuizAnswerCommand(chatId, args, quoted, duel, sender);
  }

  const game = quizGames.get(chatId);
  if (game) {
    quizGames.delete(chatId);
    const result = evaluateQuizAnswer(args, game);
    const image = await quizResultCardBuffer({
      title: result.ok ? 'RESPOSTA CERTA' : 'RESPOSTA ERRADA',
      answer: game.options[game.correctIndex],
      detail: result.ok ? 'Cleiton confirmou sua resposta.' : 'O gabarito estava na resposta certa.',
      tone: result.ok ? 'safe' : 'danger'
    });
    return safeSendMessage(chatId, {
      image,
      caption: result.ok
        ? `Correto. Resposta: *${game.options[game.correctIndex]}*.`
        : `Errou. Resposta certa: *${game.options[game.correctIndex]}*.`
    }, { quoted }, 'quizAnswer');
  }

  const oldTrivia = triviaGames.get(chatId);
  if (oldTrivia) return triviaAnswerCommand(chatId, args, quoted);
  return sendText(chatId, `Nao tem quiz aberto. Use ${prefix()}quiz ou ${prefix()}dueloquiz @pessoa.`, quoted);
}

async function duelQuizAnswerCommand(chatId, args, quoted, game, sender) {
  const meta = await sock.groupMetadata(chatId).catch(() => null);
  if (!meta) return sendText(chatId, 'Nao consegui conferir o grupo agora.', quoted);
  const player = sameParticipant(sender, game.challenger) ? game.challenger : game.challenged;
  if (game.answers[player]) return sendText(chatId, 'Sua resposta dessa rodada ja foi registrada.', quoted);
  const result = evaluateQuizAnswer(args, game.currentQuestion);
  game.answers[player] = { ok: result.ok, raw: args };
  debugLog('DUEL_QUIZ_ANSWER', { chat: shortJid(chatId), player: shortJid(player), round: game.round, ok: result.ok });

  const other = sameParticipant(player, game.challenger) ? game.challenged : game.challenger;
  const playerMention = await mentionFor(chatId, player, meta);
  const otherMention = await mentionFor(chatId, other, meta);
  if (!game.answers[other]) {
    duelQuizGames.set(chatId, game);
    return sendMentionText(chatId, `${playerMention.text} respondeu. Falta ${otherMention.text}.`, [playerMention.jid, otherMention.jid], quoted);
  }

  for (const jid of [game.challenger, game.challenged]) {
    if (game.answers[jid]?.ok) game.scores[jid] = (game.scores[jid] || 0) + 1;
  }
  const challenger = await mentionFor(chatId, game.challenger, meta);
  const challenged = await mentionFor(chatId, game.challenged, meta);
  const answer = game.currentQuestion.options[game.currentQuestion.correctIndex];
  const roundSummary = [
    `Gabarito: *${answer}*`,
    `${challenger.text}: ${game.answers[game.challenger]?.ok ? 'acertou' : 'errou'}`,
    `${challenged.text}: ${game.answers[game.challenged]?.ok ? 'acertou' : 'errou'}`,
    `Placar: ${game.scores[game.challenger] || 0} x ${game.scores[game.challenged] || 0}`
  ].join('\n');

  if (game.round >= game.maxRounds) {
    duelQuizGames.delete(chatId);
    const leftScore = game.scores[game.challenger] || 0;
    const rightScore = game.scores[game.challenged] || 0;
    const winner = leftScore === rightScore ? null : leftScore > rightScore ? challenger : challenged;
    const image = await duelQuizStatusCardBuffer({
      title: winner ? 'VENCEDOR DO QUIZ' : 'EMPATE NO QUIZ',
      badge: 'FIM DO DUELO',
      status: winner ? `${winner.text} levou` : 'empate',
      left: challenger.text,
      right: challenged.text,
      leftScore,
      rightScore,
      round: game.round,
      maxRounds: game.maxRounds,
      tone: winner ? 'safe' : 'pending'
    });
    return safeSendMessage(chatId, {
      image,
      caption: [`*Dueloquiz encerrado*`, '', roundSummary, '', winner ? `Vencedor: ${winner.text}` : 'Resultado: empate.'].join('\n'),
      mentions: [challenger.jid, challenged.jid].filter(Boolean)
    }, { quoted }, 'duelQuizFinish');
  }

  game.round += 1;
  game.currentQuestion = await fetchQuizQuestion();
  game.answers = {};
  duelQuizGames.set(chatId, game);
  await sendMentionText(chatId, [`*Rodada encerrada*`, '', roundSummary].join('\n'), [challenger.jid, challenged.jid], quoted);
  return sendDuelQuizQuestion(chatId, meta, game, quoted);
}

async function fetchQuizQuestion() {
  const fallback = randomLocalQuizQuestion();
  try {
    const url = 'https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return fallback;
    const payload = await response.json();
    const item = payload?.results?.[0];
    if (!item?.question || !item?.correct_answer || !Array.isArray(item.incorrect_answers)) return fallback;
    const correct = decodeQuizText(item.correct_answer);
    const options = shuffled([correct, ...item.incorrect_answers.map(decodeQuizText)]).slice(0, 4);
    return {
      question: decodeQuizText(item.question),
      options,
      correctIndex: Math.max(0, options.findIndex((option) => option === correct)),
      source: 'opentdb'
    };
  } catch (error) {
    debugLog('QUIZ_API_FAIL', { error: error?.message || String(error) });
    return fallback;
  }
}

function randomLocalQuizQuestion() {
  const questions = [
    { q: 'Qual comando mostra o menu principal do Cleiton?', a: 'menu', options: ['menu', 'ping', 'play', 'sticker'] },
    { q: 'Qual comando baixa audio por nome ou link?', a: 'play', options: ['play', 'rank', 'warn', 'perfil'] },
    { q: 'Qual comando mostra o ranking do grupo?', a: 'rank', options: ['rank', 'dono', 'del', 'voz'] },
    { q: 'Qual comando abre uma roleta entre membros?', a: 'roletarussa', options: ['roletarussa', 'casal', 'piada', 'qr'] },
    { q: 'Qual comando transforma imagem em figurinha?', a: 'sticker', options: ['sticker', 'quiz', 'relatorio', 'mute'] },
    { q: 'Qual e o nome do bot da tropa?', a: 'cleiton', options: ['cleiton', 'porteiro', 'contador', 'visitante'] }
  ];
  const item = randomItem(questions);
  const options = shuffled(item.options);
  return {
    question: item.q,
    options,
    correctIndex: Math.max(0, options.findIndex((option) => option === item.a)),
    source: 'local'
  };
}

function evaluateQuizAnswer(rawAnswer = '', game) {
  const clean = normalizeQuizAnswer(rawAnswer);
  const selectedNumber = Number(clean.match(/\d+/)?.[0] || 0);
  const selectedIndex = selectedNumber >= 1 && selectedNumber <= game.options.length ? selectedNumber - 1 : -1;
  const byNumber = selectedIndex === game.correctIndex;
  const correctText = normalizeQuizAnswer(game.options[game.correctIndex]);
  const byText = clean && (clean === correctText || correctText.includes(clean) || clean.includes(correctText));
  return { ok: byNumber || byText, selectedIndex };
}

function normalizeQuizAnswer(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

function decodeQuizText(value = '') {
  let text = String(value || '');
  try {
    text = decodeURIComponent(text);
  } catch {}
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ntilde;/g, 'ñ')
    .trim();
}

function quizQuestionCaption(question, title = '*Quiz*') {
  return [
    title,
    '',
    question.question,
    '',
    ...question.options.map((option, index) => `${index + 1}. ${option}`),
    '',
    `Responda com ${prefix()}responder 1, 2, 3 ou 4.`
  ].filter((line) => line !== '').join('\n');
}

async function triviaCommand(chatId, args, quoted) {
  const questions = [
    { q: 'Qual comando mostra este menu de brincadeiras?', a: 'menubrin' },
    { q: 'Qual e o nome do bot da tropa?', a: 'cleiton' },
    { q: 'Qual comando baixa audio por nome ou link?', a: 'play' },
    { q: 'Qual comando transforma texto em figurinha RGB?', a: 'ttp' }
  ];
  const item = randomItem(questions);
  triviaGames.set(chatId, item);
  return sendText(chatId, `*Trivia do Cleiton*\n\n${item.q}\n\nResponda com ${prefix()}responder sua resposta`, quoted);
}

async function triviaAnswerCommand(chatId, args, quoted) {
  const game = triviaGames.get(chatId);
  if (!game) return sendText(chatId, `Nao tem trivia aberta. Use ${prefix()}trivia.`, quoted);
  triviaGames.delete(chatId);
  const ok = args.trim().toLowerCase() === game.a;
  return sendText(chatId, ok ? `Correto. Cleiton confirmou: *${game.a}*.` : `Errou por pouco. Resposta certa: *${game.a}*.`, quoted);
}

function stablePercent(seed = '') {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 101;
}

function couplePercent(a = '', b = '') {
  return stablePercent(`${couplePairKey(a, b)}:cleiton-casal-v1`);
}

function couplePairKey(a = '', b = '') {
  return [normalizeJid(a), normalizeJid(b)].sort().join(':');
}

function shuffled(items = []) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function rememberCouple(chatId, a, b) {
  if (!chatId || !a || !b) return;
  const key = couplePairKey(a, b);
  const previous = recentCouples.get(chatId) || [];
  recentCouples.set(chatId, [key, ...previous.filter((item) => item !== key)].slice(0, 14));
}

function randomCoupleParticipants(meta, sender = '') {
  const chatId = meta?.id || meta?.jid || '';
  const candidates = new Map();
  const addCandidate = (jid = '') => {
    const normalized = normalizeJid(jid);
    if (!normalized || isBotParticipant(normalized)) return;
    for (const existing of candidates.keys()) {
      if (sameParticipant(existing, normalized)) return;
    }
    candidates.set(normalized, true);
  };

  for (const participant of meta?.participants || []) {
    addCandidate(participant.id || participant.phoneNumber || participant.lid);
  }

  const cachedProfiles = chatId ? listMemberProfiles(chatId) : [];
  for (const row of cachedProfiles) {
    addCandidate(row.user_id || row.phone_jid || row.lid_jid);
  }

  const unique = [...candidates.keys()];
  const senderIndex = unique.findIndex((jid) => sameParticipant(jid, sender));
  if (senderIndex > -1 && unique.length > 2 && randomInt(100) < 45) {
    unique.splice(senderIndex, 1);
  }

  if (unique.length < 2) return unique;

  const pairs = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      pairs.push([unique[i], unique[j]]);
    }
  }

  const recent = new Set(recentCouples.get(chatId) || []);
  const picked = shuffled(pairs).find(([a, b]) => !recent.has(couplePairKey(a, b))) || shuffled(pairs)[0];
  if (!picked) return unique.slice(0, 2);
  rememberCouple(chatId, picked[0], picked[1]);
  return picked;
}

function coupleMemberName(meta, jid, message, mention, index) {
  const chatId = message?.key?.remoteJid || meta?.id || '';
  const participant = findParticipant(meta, jid);
  const targetIsSender = sameParticipant(jid, senderJid(message));
  const cached = cachedMemberName(chatId, jid, meta, message, mention);
  const candidates = [
    cached,
    mentionNameFromMessage(message, jid),
    participantName(participant, jid),
    contactNameFor(jid, participant?.phoneNumber, participant?.id, participant?.lid, mention?.jid),
    mentionNameText(mention?.text || ''),
    targetIsSender ? cleanContactName(message?.pushName) : ''
  ];
  for (const candidate of candidates) {
    const clean = cleanCardName(candidate);
    if (clean) return truncateText(clean, 18);
  }
  return index === 1 ? 'Crush surpresa' : 'Par misterioso';
}

function randomItem(items = []) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items = [], seed = '') {
  return [...items].sort((a, b) => stablePercent(`${seed}:${a}`) - stablePercent(`${seed}:${b}`));
}

function maskedWord(game) {
  return game.word.split('').map((char) => game.guessed.has(char) ? char : '_').join(' ');
}

const cleitonFlirts = [
  'Cantada registrada: voce e o Wi-Fi daqui? Porque quando aparece, o grupo inteiro conecta.',
  'Cleiton anotou: se beleza fosse regra, voce ja tinha fixado no topo.',
  'Voce nao e Wi-Fi, mas quando aparece melhora o ambiente.'
];

const cleitonMemes = [
  'Meme do chat: quando o admin fala "sem spam" e o grupo manda 47 figurinhas em 8 segundos.',
  'Relatorio de meme: o grupo esta rindo, mas o Cleiton ja abriu sindicancia.',
  'Meme arquivado: "eu so vou mandar uma mensagem" - ultimas palavras antes do flood.'
];

const cleitonJokes = [
  'O Cleiton tentou organizar o grupo. Cinco minutos depois, ele tambem entrou na bagunca.',
  'Sabe por que o admin levou uma prancheta para o grupo? Porque toda treta precisava de ata.',
  'O Cleiton foi baixar uma musica e voltou com dois audios e uma desculpa do YouTube.',
  'Perguntaram se o Cleiton trabalha remoto. Ele disse que sim: debaixo do chat.',
  'O grupo ficou tao parado que o Cleiton abriu chamado contra o silencio.',
  'Sabe qual e o esporte favorito do Cleiton? Corrida de mensagem apagada. O X9 sempre ganha.',
  'O Cleiton entrou no grupo e falou: calma, gente, eu sou pequeno, mas meu relatorio e grande.',
  'O admin disse "sem flood". O grupo respondeu com 18 figurinhas. Cleiton chamou isso de auditoria visual.',
  'A barata do RH perguntou meu cargo. Eu disse membro. Ela confirmou: suspeito, mas passa.',
  'O Cleiton nao dorme. Ele fica em modo economia de energia.',
  'Sabe por que o Cleiton nao usa cadeira gamer? Porque ele prefere ficar no chat com postura de servidor publico.',
  'O bot tentou ser serio por cinco minutos. Ai alguem mandou "kkkk" e ele abriu um processo de risada.',
  'Cleiton foi fazer backup do grupo e descobriu que metade do banco era audio de 2 minutos dizendo nada.',
  'Quando o grupo fecha, Cleiton chama de paz. Quando abre, chama de coragem.',
  'O Cleiton foi estudar IA e saiu respondendo: entendi sua solicitacao, mas primeiro leia as regras.',
  'Sabe por que a figurinha demorou? Porque o Cleiton estava recortando com a antena.',
  'O Cleiton tem uma tampa de margarina como mesa de reuniao.',
  'O Cleiton nao bane ninguem com raiva. Ele remove com carinho administrativo.',
  'Se o grupo fosse uma empresa, o Cleiton seria o setor que manda email com "conforme alinhado".',
  'O Cleiton tentou fazer piada curta, mas abriu uma sindicancia no meio.'
];

function nextCleitonJoke(chatId) {
  const last = lastJokes.get(chatId);
  let joke = randomItem(cleitonJokes);
  if (cleitonJokes.length > 1) {
    let guard = 0;
    while (joke === last && guard < 8) {
      joke = randomItem(cleitonJokes);
      guard += 1;
    }
  }
  lastJokes.set(chatId, joke);
  return joke;
}

async function requireGroupAdmin(chatId, user, quoted) {
  if (!chatId.endsWith('@g.us')) {
    await sendText(chatId, 'Esse comando só funciona em grupo.', quoted);
    return null;
  }
  const meta = await sock.groupMetadata(chatId);
  const actor = meta.participants.find((p) => sameParticipant(p.id, user));
  const bot = meta.participants.find((p) => isBotParticipant(p.id));
  const owner = await isOwner(user) || await isOwner(actor?.phoneNumber) || await isOwner(actor?.id) || await isOwner(actor?.lid);
  if (!owner && !actor?.admin) {
    await sendText(chatId, 'So admin usa esse comando.', quoted);
    return null;
  }
  if (!bot?.admin) {
    await sendText(chatId, 'Cleiton precisa ser admin para fazer isso.', quoted);
    return null;
  }
  return meta;
}

async function requireRouletteGroup(chatId, quoted) {
  if (!chatId.endsWith('@g.us')) {
    await sendText(chatId, 'Roleta so funciona em grupo.', quoted);
    return null;
  }
  const meta = await sock.groupMetadata(chatId);
  const bot = meta.participants.find((p) => isBotParticipant(p.id));
  if (!bot?.admin) {
    await sendText(chatId, 'Cleiton precisa ser admin para remover o perdedor da roleta.', quoted);
    return null;
  }
  return meta;
}

function roulettePlayerId(meta, jid = '') {
  const participant = findParticipant(meta, jid);
  return normalizeJid(participant?.id || participant?.phoneNumber || participant?.lid || jid);
}

function participantActionJid(meta, jid = '') {
  const participant = findParticipant(meta, jid);
  return normalizeJid(participant?.id || participant?.phoneNumber || participant?.lid || jid);
}

async function requireActorAdmin(chatId, user, quoted) {
  if (!chatId.endsWith('@g.us')) {
    await sendText(chatId, 'Esse comando só funciona em grupo.', quoted);
    return null;
  }
  const meta = await sock.groupMetadata(chatId);
  const actor = meta.participants.find((p) => sameParticipant(p.id, user));
  const owner = await isOwner(user) || await isOwner(actor?.phoneNumber) || await isOwner(actor?.id) || await isOwner(actor?.lid);
  if (!owner && !actor?.admin) {
    await sendText(chatId, 'So admin usa esse comando.', quoted);
    return null;
  }
  return meta;
}

async function ownerOnly(chatId, quoted) {
  if (await isOwner(senderJid(quoted))) return true;
  await sendText(chatId, 'Esse setor RH é sala do dono. Cleiton fechou a portinha.', quoted);
  return false;
}

function isBotParticipant(participantId = '') {
  const botNumber = onlyDigits(process.env.BOT_NUMBER || process.env.PAIRING_NUMBER || '');
  return [
    sock.user?.id,
    sock.user?.lid,
    sock.user?.jid,
    botNumber ? `${botNumber}@s.whatsapp.net` : ''
  ].some((candidate) => sameParticipant(participantId, candidate));
}

function sameParticipant(a = '', b = '') {
  const left = normalizeJid(a);
  const right = normalizeJid(b);
  if (left && right && left === right) return true;
  const leftDigits = onlyDigits(left);
  const rightDigits = onlyDigits(right);
  return Boolean(leftDigits && rightDigits && (leftDigits === rightDigits || leftDigits.includes(rightDigits) || rightDigits.includes(leftDigits)));
}

async function mentionFor(chatId, jid, meta = null) {
  const groupMeta = meta || (chatId?.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null);
  const participant = findParticipant(groupMeta, jid);
  const mappedPn = await pnForJid(participant?.phoneNumber || participant?.id || jid);
  return mentionFromParticipant(participant, jid, mappedPn);
}

function findParticipant(meta, jid = '') {
  if (!meta?.participants?.length) return null;
  return meta.participants.find((participant) => [
    participant.id,
    participant.lid,
    participant.phoneNumber
  ].some((candidate) => sameParticipant(candidate, jid))) || null;
}

function mentionFromParticipant(participant, fallbackJid = '', mappedPn = '') {
  const mentionJid = normalizeJid(mappedPn || participant?.phoneNumber || participant?.id || participant?.lid || fallbackJid);
  const labelJid = normalizeJid(mappedPn || participant?.phoneNumber || (!isLidJid(participant?.id) ? participant?.id : '') || fallbackJid);
  const labelDigits = onlyDigits(labelJid);
  const fallbackDigits = onlyDigits(fallbackJid);
  const displayName = participantName(participant, fallbackJid)
    || contactNameFor(fallbackJid, mappedPn, participant?.phoneNumber, participant?.id, participant?.lid);
  let text = displayName ? `@${displayName}` : 'novo integrante';
  let real = Boolean(mentionJid);

  if (!displayName && labelDigits && !isLidJid(labelJid)) {
    text = `@${labelDigits}`;
    real = true;
  } else if (!displayName && fallbackDigits && !isLidJid(fallbackJid)) {
    text = `@${fallbackDigits}`;
    real = true;
  }

  return { text, jid: mentionJid, real };
}

function mentionTextForWelcome(item) {
  const text = String(item?.text || '').trim();
  if (text.startsWith('@') && text !== '@' && text !== '@novo_integrante') return text;
  const digits = onlyDigits(item?.jid || '');
  return digits ? `@${digits}` : '';
}

async function pnForJid(jid = '') {
  const normalized = normalizeJid(jid);
  if (!normalized || !isLidJid(normalized)) return normalized;
  return await sock?.signalRepository?.lidMapping?.getPNForLID(normalized).catch(() => null);
}

async function profilePicture(jid = '') {
  if (!jid) return null;
  debugLog('PROFILE_PIC_URL_TRY', { jid: shortJid(jid) });
  const url = await withTimeout(sock.profilePictureUrl(jid, 'image'), 3500, null).catch((error) => {
    debugLog('PROFILE_PIC_URL_FAIL', { jid: shortJid(jid), error: error?.message || String(error) });
    return null;
  });
  debugLog('PROFILE_PIC_URL_RESULT', { jid: shortJid(jid), found: Boolean(url) });
  return url;
}

async function profileImageBuffer(...jids) {
  const uniqueJids = [...new Set(jids.filter(Boolean).map(normalizeJid))];
  for (const jid of uniqueJids) {
    const picUrl = await profilePicture(jid);
    if (!picUrl) continue;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(picUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) continue;
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      logEvent({ level: 'warn', event: 'baileys_profile_picture_error', userId: jid, message: error?.message || String(error) });
    }
  }
  return null;
}

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

function jidFromArgs(args = '') {
  const digits = onlyDigits(args);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function isLidJid(jid = '') {
  return String(jid).includes('@lid');
}

async function isOwner(jid) {
  const normalized = normalizeJid(jid);
  const candidates = [];
  if (normalized) candidates.push(normalized);
  if (isLidJid(normalized)) {
    const mappedPn = await pnForJid(normalized).catch(() => null);
    if (mappedPn) candidates.push(mappedPn);
  }

  const candidateDigits = candidates
    .map(onlyDigits)
    .filter((digits) => digits.length >= 8);

  return ownerNumbers().some((owner) => candidateDigits.some((digits) => (
    digits === owner
    || digits.endsWith(owner)
    || owner.endsWith(digits)
  )));
}

function rememberMessage(message) {
  const key = messageStoreKey(message.key);
  deletedStore.set(key, { text: extractText(message), sender: senderJid(message) });
  if (deletedStore.size > 500) deletedStore.delete(deletedStore.keys().next().value);
}

function rememberRecentMessage(message) {
  const chatId = message.key.remoteJid;
  const list = recentMessages.get(chatId) || [];
  list.push(message);
  recentMessages.set(chatId, list.slice(-60));
}

function rememberSentMessage(message) {
  if (!message?.key?.id || !message.message) return;
  sentMessages.set(messageStoreKey(message.key), {
    message: message.message,
    createdAt: Date.now()
  });
  pruneSentMessages();
}

function storedMessageContent(key = {}) {
  if (!key?.id) return undefined;
  const direct = sentMessages.get(messageStoreKey(key));
  if (direct?.message) return direct.message;
  const chatId = key.remoteJid;
  const recent = (recentMessages.get(chatId) || []).find((message) => message.key?.id === key.id);
  return recent?.message;
}

function pruneSentMessages() {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const [key, value] of sentMessages.entries()) {
    if ((value.createdAt || 0) < cutoff) sentMessages.delete(key);
  }
  while (sentMessages.size > 250) sentMessages.delete(sentMessages.keys().next().value);
}

function rememberContactFromMessage(message) {
  const jid = senderJid(message);
  rememberContactName(jid, message.pushName);
}

function rememberContactName(jid = '', name = '') {
  const cleanName = cleanContactName(name);
  if (!jid || !cleanName) return;
  const normalized = normalizeJid(jid);
  contactNames.set(normalized, cleanName);
  const digits = onlyDigits(normalized);
  if (digits) contactNames.set(digits, cleanName);
  debugLog('CONTACT_NAME_CACHE', { jid: shortJid(normalized), name: cleanName, cacheSize: contactNames.size });
}

async function logIncomingMessage(message) {
  const chatId = message.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  const sender = senderJid(message);
  const senderName = cleanContactName(message.pushName) || contactNameFor(sender) || shortJid(sender) || 'sem nome';
  const text = compactText(extractText(message)) || mediaLogLabel(message);
  let chatName = isGroup ? groupNames.get(chatId) : 'PV';
  if (isGroup && !chatName) {
    const meta = await withTimeout(sock.groupMetadata(chatId).catch(() => null), 1200, null);
    chatName = meta?.subject || shortJid(chatId);
    if (chatName) groupNames.set(chatId, chatName);
  }
  const scopeColor = isGroup ? ansi.magenta : ansi.cyan;
  const scope = isGroup ? 'GRUPO' : 'PV';
  const fromMe = message.key.fromMe ? 'sim' : 'nao';
  const lines = [
    `${ansi.dim}+--------------------------------------------------+${ansi.reset}`,
    `${scopeColor}${ansi.bold}| CLEITON LOG | ${scope}${ansi.reset} ${ansi.dim}${new Date().toLocaleString('pt-BR', { hour12: false })}${ansi.reset}`,
    `${ansi.green}| Chat:${ansi.reset} ${chatName || shortJid(chatId)}`,
    `${ansi.green}| De:${ansi.reset} ${senderName} ${ansi.dim}<${shortJid(sender)}>${ansi.reset}`,
    `${ansi.green}| ID:${ansi.reset} ${message.key.id || 'sem id'} ${ansi.green}| FromMe:${ansi.reset} ${fromMe}`,
    `${ansi.yellow}| Msg:${ansi.reset} ${text || '[sem texto]'}`,
    `${ansi.dim}+--------------------------------------------------+${ansi.reset}`
  ];
  console.log(lines.join('\n'));
}

async function sendDiscordMessageLog(message) {
  const cfg = loadCleitonConfig();
  if (!cfg.discord?.enabled) return false;
  const chatId = message.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  const sender = senderJid(message);
  const mappedSender = await pnForJid(sender).catch(() => null);
  const senderNumber = onlyDigits(mappedSender || sender) || onlyDigits(sender) || 'sem numero';
  const senderName = cleanContactName(message.pushName) || contactNameFor(sender, mappedSender) || shortJid(sender) || 'sem nome';
  const text = extractText(message) || mediaLogLabel(message) || '[sem texto]';
  const chatName = await chatDisplayName(chatId);
  const embed = {
    title: isGroup ? 'Mensagem em grupo' : 'Mensagem no privado',
    color: isGroup ? 0x22c55e : 0x38bdf8,
    timestamp: new Date().toISOString(),
    fields: [
      { name: 'Quem enviou', value: truncateDiscord(senderName, 256), inline: true },
      { name: 'Número', value: `+${senderNumber}`, inline: true },
      { name: 'Origem', value: isGroup ? `Grupo: ${truncateDiscord(chatName, 220)}` : 'Privado', inline: false },
      { name: 'JID', value: truncateDiscord(shortJid(sender), 256), inline: true },
      { name: 'Chat ID', value: truncateDiscord(shortJid(chatId), 256), inline: true },
      { name: 'Mensagem', value: truncateDiscord(text, 950), inline: false }
    ],
    footer: { text: `Cleiton | ${message.key.id || 'sem id'}` }
  };
  return postDiscordWebhook('messages', {
    username: 'Cleiton Logs',
    allowed_mentions: { parse: [] },
    embeds: [embed]
  });
}

async function sendDiscordLog(title, description = '', fields = [], color = 0x10b981) {
  return postDiscordWebhook('logs', {
    username: 'Cleiton Monitor',
    allowed_mentions: { parse: [] },
    embeds: [{
      title,
      description: truncateDiscord(description, 1200),
      color,
      timestamp: new Date().toISOString(),
      fields: fields
        .filter((field) => field?.name && field?.value !== undefined && field?.value !== null)
        .slice(0, 20)
        .map((field) => ({
          name: truncateDiscord(field.name, 256),
          value: truncateDiscord(field.value, 1024),
          inline: Boolean(field.inline)
        })),
      footer: { text: 'Cleiton | logs persistentes' }
    }]
  });
}

async function postDiscordWebhook(kind, payload, retry = true) {
  const cfg = loadCleitonConfig();
  const discord = cfg.discord || {};
  if (!discord.enabled) return false;
  const url = kind === 'messages' ? discord.messagesWebhookUrl : discord.logsWebhookUrl;
  if (!url) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (response.status === 429 && retry) {
      const json = await response.json().catch(() => ({}));
      const delay = Math.min(6000, Math.max(1000, Math.ceil(Number(json.retry_after || 1) * 1000)));
      await sleep(delay);
      return postDiscordWebhook(kind, payload, false);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      debugLog('DISCORD_WEBHOOK_HTTP_FAIL', { kind, status: response.status, body: compactText(body) });
      return false;
    }
    return true;
  } catch (error) {
    debugLog('DISCORD_WEBHOOK_FAIL', { kind, error: error?.message || String(error) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function scheduleDiscordGroupSnapshots() {
  if (discordGroupSnapshotTimer) clearInterval(discordGroupSnapshotTimer);
  discordGroupSnapshotTimer = null;
  const cfg = loadCleitonConfig();
  if (!cfg.discord?.enabled || !cfg.discord?.logsWebhookUrl) return;
  const minutes = Math.max(10, Math.min(Number(cfg.discord.groupSnapshotIntervalMinutes) || 60, 1440));
  discordGroupSnapshotTimer = setInterval(() => {
    void sendDiscordGroupsSnapshot('atualização periódica').catch((error) => debugLog('DISCORD_GROUP_SNAPSHOT_FAIL', { error: error?.message || String(error) }));
  }, minutes * 60 * 1000);
}

function scheduleDiscordGroupsSnapshotSoon(reason = 'mudança detectada') {
  const cfg = loadCleitonConfig();
  if (!cfg.discord?.enabled || !cfg.discord?.logsWebhookUrl) return;
  if (discordGroupSnapshotDebounceTimer) clearTimeout(discordGroupSnapshotDebounceTimer);
  discordGroupSnapshotDebounceTimer = setTimeout(() => {
    discordGroupSnapshotDebounceTimer = null;
    void sendDiscordGroupsSnapshot(reason).catch((error) => debugLog('DISCORD_GROUP_SNAPSHOT_FAIL', { error: error?.message || String(error) }));
  }, 30000);
}

async function sendDiscordGroupsSnapshot(reason = 'atualização') {
  if (!sock) return false;
  const cfg = loadCleitonConfig();
  if (!cfg.discord?.enabled || !cfg.discord?.logsWebhookUrl) return false;
  const groupFetch = typeof sock.groupFetchAllParticipating === 'function'
    ? sock.groupFetchAllParticipating().catch(() => ({}))
    : Promise.resolve({});
  const participating = await withTimeout(groupFetch, 12000, {}) || {};
  const groups = Object.values(participating)
    .filter((group) => group?.id)
    .sort((a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), 'pt-BR'))
    .slice(0, 20);
  const fields = [];
  for (const group of groups) {
    const id = normalizeJid(group.id);
    const subject = group.subject || groupNames.get(id) || shortJid(id);
    groupNames.set(id, subject);
    const invite = await groupInviteLink(id);
    const members = group.participants?.length || group.size || 0;
    fields.push({
      name: subject,
      value: [
        `Membros: ${members}`,
        `ID: ${shortJid(id)}`,
        invite ? `Link: ${invite}` : 'Link: indisponível'
      ].join('\n'),
      inline: false
    });
  }
  if (!fields.length) fields.push({ name: 'Grupos', value: 'Nenhum grupo retornado agora.', inline: false });
  return sendDiscordLog('Grupos onde o Cleiton está', `Motivo: ${reason}`, fields, 0x14b8a6);
}

async function groupInviteLink(chatId) {
  const cached = discordInviteCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) return cached.link;
  const code = await withTimeout(sock.groupInviteCode(chatId).catch(() => ''), 5000, '');
  const link = code ? `https://chat.whatsapp.com/${code}` : '';
  discordInviteCache.set(chatId, { link, expiresAt: Date.now() + 60 * 60 * 1000 });
  return link;
}

async function chatDisplayName(chatId) {
  if (!chatId?.endsWith('@g.us')) return 'PV';
  const cached = groupNames.get(chatId);
  if (cached) return cached;
  const meta = await withTimeout(sock.groupMetadata(chatId).catch(() => null), 1200, null);
  const name = meta?.subject || shortJid(chatId);
  if (name) groupNames.set(chatId, name);
  return name;
}

function truncateDiscord(value = '', max = 1024) {
  const text = String(value || '').trim();
  if (text.length <= max) return text || '-';
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function mediaLogLabel(message) {
  const msg = message.message || {};
  if (msg.imageMessage) return '[imagem]';
  if (msg.videoMessage) return '[video]';
  if (msg.audioMessage) return '[audio]';
  if (msg.stickerMessage) return '[figurinha]';
  if (msg.documentMessage) return '[documento]';
  if (msg.reactionMessage) return '[reacao]';
  return '';
}

function contactNameFor(...jids) {
  for (const jid of jids.filter(Boolean)) {
    const normalized = normalizeJid(jid);
    const direct = cleanContactName(contactNames.get(normalized));
    if (direct) return direct;
    const byDigits = cleanContactName(contactNames.get(onlyDigits(normalized)));
    if (byDigits) return byDigits;
  }
  return '';
}

function cleanContactName(name = '') {
  const value = String(name || '').trim();
  if (!value || looksLikePhoneName(value)) return '';
  return value;
}

function messageStoreKey(key) {
  return `${key.remoteJid}:${key.id}`;
}

function extractText(message) {
  const msg = message.message || {};
  const nativeFlowParams = msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  let nativeFlowId = '';
  if (nativeFlowParams) {
    try {
      const parsed = JSON.parse(nativeFlowParams);
      nativeFlowId = parsed.id || parsed.selectedId || parsed.button_id || '';
    } catch {}
  }
  return msg.conversation
    || msg.extendedTextMessage?.text
    || msg.imageMessage?.caption
    || msg.videoMessage?.caption
    || msg.buttonsResponseMessage?.selectedButtonId
    || msg.listResponseMessage?.singleSelectReply?.selectedRowId
    || msg.templateButtonReplyMessage?.selectedId
    || nativeFlowId
    || '';
}

function getMediaMessage(message) {
  const msg = message.message || {};
  const quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage;
  return msg.imageMessage || msg.videoMessage || msg.stickerMessage || quoted?.imageMessage || quoted?.videoMessage || quoted?.stickerMessage || null;
}

async function downloadMedia(mediaMessage) {
  const type = Object.keys(mediaMessage)[0] ? mediaMessage : mediaMessage;
  const mediaType = mediaMessage.mimetype?.startsWith('video') ? 'video' : mediaMessage.url ? 'image' : 'image';
  const stream = await downloadContentFromMessage(type, mediaType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function targetJid(message) {
  const ctx = message.message?.extendedTextMessage?.contextInfo;
  const mentions = mentionedJids(message);
  if (mentions.length > 1) return mentions.find((jid) => !isBotParticipant(jid)) || mentions[0];
  return mentions[0] || ctx?.participant || null;
}

function resolveProfileTarget(meta, args, message) {
  const mentioned = targetJid(message);
  if (mentioned) return mentioned;
  const byNumber = jidFromArgs(args);
  if (byNumber) return byNumber;
  return senderJid(message);
}

function findParticipantByText(meta, text = '') {
  const needle = text.replace(/^@+/, '').trim().toLowerCase();
  if (!needle || !meta?.participants?.length) return null;
  return meta.participants.find((participant) => {
    const values = [
      participantName(participant),
      participant.id,
      participant.lid,
      participant.phoneNumber
    ].filter(Boolean).map((value) => String(value).replace(/^@+/, '').toLowerCase());
    return values.some((value) => value === needle || value.includes(needle));
  }) || null;
}

function participantName(participant, fallbackJid = '') {
  if (isBotParticipant(participant?.id || fallbackJid)) return cleitonProfile.botName;
  if (!participant) return '';
  const value = participant.notify || participant.name || participant.username || '';
  return cleanContactName(value);
}

function senderJid(message) {
  return normalizeJid(message.key.participant || message.key.remoteJid);
}

function mentionNameFromMessage(message, target = '') {
  const mentions = mentionedJids(message);
  const index = mentions.findIndex((jid) => sameParticipant(jid, target));
  if (index < 0) return '';
  const text = extractText(message).replace(new RegExp(`^\\${prefix()}\\S+\\s*`), '').trim();
  const pieces = text.split('@').slice(1);
  const raw = pieces[index] || pieces[0] || '';
  const value = raw
    .replace(/\s+@\S.*$/, '')
    .replace(/\s{2,}.*/, '')
    .trim();
  if (!value || onlyDigits(value).length >= 8) return '';
  return value;
}

function mentionNameText(text = '') {
  const value = String(text).replace(/^@/, '').trim();
  return value && !looksLikePhoneName(value) ? value : '';
}

function looksLikePhoneName(value = '') {
  const digits = onlyDigits(value);
  const compact = String(value).replace(/[\s+().-]/g, '');
  return Boolean(digits.length >= 8 && !/\p{L}/u.test(compact));
}

function mentionedJids(message) {
  const msg = message.message || {};
  const contexts = [
    msg.extendedTextMessage?.contextInfo,
    msg.imageMessage?.contextInfo,
    msg.videoMessage?.contextInfo,
    msg.documentMessage?.contextInfo,
    msg.stickerMessage?.contextInfo,
    msg.buttonsResponseMessage?.contextInfo,
    msg.listResponseMessage?.contextInfo
  ].filter(Boolean);
  const mentions = [];
  for (const ctx of contexts) {
    if (Array.isArray(ctx.mentionedJid)) mentions.push(...ctx.mentionedJid);
  }
  if (Array.isArray(msg.extendedTextMessage?.mentionedJid)) mentions.push(...msg.extendedTextMessage.mentionedJid);
  if (Array.isArray(msg.mentionedJid)) mentions.push(...msg.mentionedJid);
  return [...new Set(mentions.map(normalizeJid).filter(Boolean))];
}

function shortJid(jid = '') {
  const normalized = normalizeJid(jid);
  if (!normalized) return '';
  const [user, server = ''] = normalized.split('@');
  const cleanUser = user.length > 14 ? `${user.slice(0, 6)}...${user.slice(-4)}` : user;
  return server ? `${cleanUser}@${server}` : cleanUser;
}

function compactText(text = '') {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function formatDuration(totalSeconds = 0) {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);
  return [
    days ? `${days}d` : '',
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    `${seconds}s`
  ].filter(Boolean).join(' ');
}

async function safeSendMessage(chatId, content, options, label = 'sendMessage') {
  try {
    debugLog('SEND_TRY', {
      label,
      chat: shortJid(chatId),
      hasMentions: Boolean(content?.mentions?.length),
      type: Object.keys(content || {}).join(',')
    });
    const result = await sock.sendMessage(chatId, content, options);
    rememberSentMessage(result);
    debugLog('SEND_OK', { label, chat: shortJid(chatId), id: result?.key?.id || '' });
    return result;
  } catch (error) {
    debugLog('SEND_FAIL', {
      label,
      chat: shortJid(chatId),
      status: error?.output?.statusCode || '',
      error: error?.message || String(error)
    });
    if (isConnectionClosedError(error)) scheduleReconnect('send falhou: conexao fechada', 1500);
    return null;
  }
}

function isConnectionClosedError(error) {
  return /connection closed|timedout|connection terminated/i.test(error?.message || String(error))
    || [408, 428, 515].includes(Number(error?.output?.statusCode));
}

function normalizeJid(jid = '') {
  return String(jid).replace(/:\d+@/, '@');
}

function formatJid(jid = '') {
  return `@${onlyDigits(jid)}`;
}

function onlyDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapStickerWords(text = '', max = 12) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= max) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function prefix() {
  return getSetting('COMMAND_PREFIX', '!');
}

function rulesText() {
  return getSetting('REGRAS_GRUPO', '').replace(/\\n/g, '\n');
}

function boolSetting(key) {
  return String(getSetting(key, defaults[key] || 'false')).toLowerCase() === 'true';
}

function chatSettingKey(chatId, key) {
  return `${key}:${chatId}`;
}

function chatBoolSetting(chatId, key) {
  const specific = getSetting(chatSettingKey(chatId, key), '');
  if (specific !== '') return String(specific).toLowerCase() === 'true';
  return boolSetting(key);
}

function getChatSetting(chatId, key, fallback = '') {
  const specific = getSetting(chatSettingKey(chatId, key), '');
  return specific !== '' ? specific : getSetting(key, fallback);
}

function setChatSetting(chatId, key, value) {
  setSetting(chatSettingKey(chatId, key), value);
}

function onOff(key) {
  return boolSetting(key) ? 'ligado' : 'desligado';
}

function chatOnOff(chatId, key) {
  return chatBoolSetting(chatId, key) ? 'ligado' : 'desligado';
}

function normalizeToggle(args = '') {
  const value = args.trim().toLowerCase();
  if (['on', 'ligar', 'ligado', 'true', 'sim'].includes(value)) return 'true';
  if (['off', 'desligar', 'desligado', 'false', 'nao', 'não'].includes(value)) return 'false';
  return '';
}

async function sendTyping(chatId) {
  await sock.sendPresenceUpdate('composing', chatId).catch(() => {});
}

async function sendText(chatId, text, quoted) {
  return safeSendMessage(chatId, { text }, quoted ? { quoted } : undefined, 'sendText');
}

async function sendMentionText(chatId, text, mentions = [], quoted) {
  const cleanMentions = [...new Set(mentions.filter(Boolean).map(normalizeJid))];
  const result = await safeSendMessage(chatId, { text, mentions: cleanMentions }, quoted ? { quoted } : undefined, 'sendMentionText');
  if (!result && cleanMentions.length) {
    return safeSendMessage(chatId, { text }, quoted ? { quoted } : undefined, 'sendMentionTextFallback');
  }
  return result;
}

function shortCleitonAnswer(text) {
  const clean = String(text || '').replace(/(^|\s)cleiton/ig, '').trim();
  const lowered = clean.toLowerCase();
  if (!clean) return 'Estou aqui. Manda a ideia sem drama.';
  if (/planck|panck|plank/.test(lowered)) {
    return 'Se voce quis dizer constante de Planck: ela vale aproximadamente 6,62607015 x 10^-34 J.s. Cleiton anotou sem derrubar o cafe.';
  }
  if (/como (tu|voce|vc) (ta|esta)|tudo bem|suave|beleza/.test(lowered)) {
    return 'To firme, tentando parecer profissional. E voce, como esta?';
  }
  if (/obrigad|valeu|vlw|falou|tchau/.test(lowered)) {
    return 'Fechado. Cleiton guardou isso aqui.';
  }
  return clean.length > 90
    ? 'Entendi o resumo. Me manda o ponto principal que eu te respondo mais certeiro.'
    : `Entendi. Sobre isso: ${clean}`;
}

function conversationKey(chatId, sender) {
  return `${normalizeJid(chatId)}:${normalizeJid(sender)}`;
}

function pruneCleitonConversations() {
  const limit = 15 * 60 * 1000;
  for (const [key, session] of cleitonConversations) {
    if (Date.now() - session.lastAt > limit) cleitonConversations.delete(key);
  }
}

function shouldCleitonReply(chatId, sender, body = '') {
  pruneCleitonConversations();
  const text = String(body || '').trim();
  if (!text) return false;
  const key = conversationKey(chatId, sender);
  if (cleitonPausedUsers.has(key)) return false;
  const session = cleitonConversations.get(key);
  const called = /\bcleiton\b/i.test(text);
  const directQuestion = !chatId.endsWith('@g.us') && !text.startsWith(prefix());
  const active = session && Date.now() - session.lastAt < 5 * 60 * 1000;
  const stop = /\b(parou|para|fim|tchau|falou|obrigad|valeu|vlw)\b/i.test(text);
  if (stop && active) {
    cleitonConversations.delete(key);
    return called;
  }
  return called || directQuestion || active;
}

async function handleCleitonPausePhrase(chatId, sender, body = '', quoted) {
  const text = String(body || '').toLowerCase();
  if (!/\bcleiton\b/.test(text)) return false;
  if (/\b(volta|responde|pode responder|ativa|acorda|liga)\b/.test(text)) {
    resumeCleitonSession(chatId, sender);
    await sendText(chatId, 'Voltei. Cleiton reabriu o guiche.', quoted);
    return true;
  }
  if (/\b(para|pare|cala|quieto|nao responde|não responde|fica na sua|silencio|silêncio)\b/.test(text)) {
    pauseCleitonSession(chatId, sender);
    await sendText(chatId, 'Fechado. Cleiton vai ficar quietinho nesse atendimento ate voce chamar de volta.', quoted);
    return true;
  }
  return false;
}

async function pauseCleitonCommand(chatId, sender, quoted) {
  pauseCleitonSession(chatId, sender);
  await sendText(chatId, 'Cleiton pausado para voce. Quando quiser, use !voltacleiton.', quoted);
}

async function resumeCleitonCommand(chatId, sender, quoted) {
  resumeCleitonSession(chatId, sender);
  await sendText(chatId, 'Cleiton ativado de novo para voce. Chat aberto.', quoted);
}

function pauseCleitonSession(chatId, sender) {
  const key = conversationKey(chatId, sender);
  cleitonConversations.delete(key);
  cleitonPausedUsers.set(key, Date.now());
}

function resumeCleitonSession(chatId, sender) {
  const key = conversationKey(chatId, sender);
  cleitonPausedUsers.delete(key);
  cleitonConversations.delete(key);
}

function geminiModelList() {
  const models = [
    ...(process.env.GEMINI_MODELS || '').split(','),
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
  ];
  return [...new Set(models.map((model) => String(model || '').trim()).filter(Boolean))];
}

function cleanAiReply(text = '') {
  return String(text || '')
    .replace(/^cleiton:\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200);
}

async function cleitonConversationAnswer(message, text) {
  const chatId = message.key.remoteJid;
  const sender = senderJid(message);
  const key = conversationKey(chatId, sender);
  const displayName = cleanContactName(message.pushName) || contactNameFor(sender) || 'membro';
  const session = cleitonConversations.get(key) || { history: [], lastAt: 0 };
  const cleanText = String(text || '').trim();
  session.history.push({ role: 'user', text: cleanText });
  session.history = session.history.slice(-8);
  session.lastAt = Date.now();
  cleitonConversations.set(key, session);

  let answer = '';
  if (gemini) {
    const historyText = session.history
      .map((item) => `${item.role === 'user' ? displayName : 'Cleiton'}: ${item.text}`)
      .join('\n');
    const systemInstruction = [
      getSetting('BOT_PROMPT', process.env.BOT_PROMPT || 'Voce e o Cleiton.'),
      'Responda em portugues brasileiro, com boa gramatica, natural e curto.',
      'Use humor leve do Cleiton, mas sem forcar piada em toda frase.',
      'Pode responder perguntas gerais fora do tema do bot, inclusive ciencia, matematica, tecnologia e cultura.',
      'Se a pessoa escrever errado, entenda a intencao e responda de forma util. Exemplo: "constant de panck" significa constante de Planck.',
      'Nao diga que esta preso ao prompt. Nao invente configuracoes internas. Seja direto.',
      `Usuario atual: ${displayName}. Continue a conversa apenas com esse usuario; se outra pessoa falar, ela tem outra memoria.`
    ].join('\n');

    for (const model of geminiModelList()) {
      try {
        debugLog('GEMINI_TRY', { model, chat: shortJid(chatId), sender: shortJid(sender), text: compactText(cleanText) });
        const response = await gemini.models.generateContent({
          model,
          contents: `Historico recente:\n${historyText}\n\nResponda agora a ultima mensagem.`,
          config: {
            systemInstruction,
            temperature: 0.8,
            maxOutputTokens: 350
          }
        });
        answer = cleanAiReply(response.text);
        if (answer) {
          debugLog('GEMINI_OK', { model, chars: answer.length });
          break;
        }
      } catch (error) {
        debugLog('GEMINI_FAIL', {
          model,
          status: error?.status || error?.code || error?.output?.statusCode || '',
          error: compactText(error?.message || String(error))
        });
      }
    }
  }

  if (!answer) answer = shortCleitonAnswer(cleanText);
  session.history.push({ role: 'model', text: answer });
  session.history = session.history.slice(-8);
  session.lastAt = Date.now();
  cleitonConversations.set(key, session);
  return answer;
}

async function fetchBuffer(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeWindowsSpeech(text, outFile) {
  const script = [
    '& {',
    'param([string]$OutFile, [string]$Text);',
    'Add-Type -AssemblyName System.Speech;',
    '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    '$speaker.Volume = 100;',
    '$speaker.Rate = 0;',
    'try {',
    '  $voices = $speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name };',
    '  $pt = $voices | Where-Object { $_ -match "Portuguese|Brasil|Brazil|Maria|Daniel" } | Select-Object -First 1;',
    '  if ($pt) { $speaker.SelectVoice($pt); }',
    '  $speaker.SetOutputToWaveFile($OutFile);',
    '  $speaker.Speak($Text);',
    '} finally {',
    '  $speaker.Dispose();',
    '}',
    '}'
  ].join(' ');
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
    outFile,
    text
  ], { windowsHide: true, timeout: 45000 });
}

async function diceBearAvatarBuffer(seed = 'Cleiton') {
  const url = `https://api.dicebear.com/10.x/bottts-neutral/png?seed=${encodeURIComponent(seed)}&size=512&radius=50&backgroundColor=0f172a,064e3b,312e81`;
  return fetchBuffer(url, 15000);
}

async function welcomeCardBuffer(chatId, meta, item) {
  const displayName = cleanWelcomeName(item?.text) || 'Novo integrante';
  const participant = findParticipant(meta, item?.target || item?.jid);
  const avatarSource = await withTimeout(
    profileImageBuffer(
      item?.jid,
      item?.target,
      participant?.phoneNumber,
      participant?.id,
      participant?.lid
    ),
    7000,
    null
  ).catch(() => null);
  const avatar = avatarSource || await diceBearAvatarBuffer(displayName).catch(() => null);
  const roundedAvatar = avatar ? await roundedImage(avatar, 224) : null;
  const groupName = meta?.subject || groupNames.get(chatId) || 'Grupo';
  const memberCount = meta?.participants?.length || 0;
  const cleiton = cleitonImageBuffer();
  const svg = Buffer.from(`
<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#101827"/>
      <stop offset="48%" stop-color="#0f5132"/>
      <stop offset="100%" stop-color="#241332"/>
    </linearGradient>
    <radialGradient id="glow" cx="75%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#43e97b" stop-opacity=".48"/>
      <stop offset="100%" stop-color="#43e97b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" rx="42" fill="url(#bg)"/>
  <rect width="1200" height="675" rx="42" fill="url(#glow)"/>
  <g opacity=".18" stroke="#ffffff" stroke-width="2" fill="none">
    <circle cx="106" cy="96" r="36"/><circle cx="1050" cy="126" r="62"/>
    <path d="M60 560 C210 480 260 650 410 555 S650 520 760 620 S980 585 1130 500"/>
    <path d="M910 70 l60 34 -22 67 -71 0 -22 -67z"/>
  </g>
  <rect x="62" y="58" width="1076" height="559" rx="34" fill="#08111f" opacity=".56" stroke="#ffffff" stroke-opacity=".12"/>
  <text x="92" y="120" fill="#a7f3d0" font-size="31" font-family="Arial, sans-serif" font-weight="700">CLEITON</text>
  <text x="92" y="170" fill="#ffffff" font-size="54" font-family="Arial, sans-serif" font-weight="900">Bem-vindo(a)</text>
  <text x="360" y="304" fill="#ffffff" font-size="58" font-family="Arial, sans-serif" font-weight="900">${escapeXml(displayName)}</text>
  <text x="362" y="360" fill="#d1fae5" font-size="30" font-family="Arial, sans-serif">Chegou na ${escapeXml(truncateText(groupName, 34))}</text>
  <text x="362" y="412" fill="#ffffff" opacity=".92" font-size="28" font-family="Arial, sans-serif">Leia as regras, respeite a tropa e nao derrube o chat.</text>
  <text x="362" y="462" fill="#86efac" font-size="25" font-family="Arial, sans-serif">Membros no grupo: ${memberCount || '-'}</text>
  <rect x="92" y="528" width="690" height="54" rx="27" fill="#22c55e" opacity=".18"/>
  <text x="122" y="564" fill="#dcfce7" font-size="25" font-family="Arial, sans-serif" font-weight="700">Entrada confirmada. Registro aceito.</text>
  <text x="904" y="572" fill="#d1d5db" font-size="23" font-family="Arial, sans-serif" font-style="italic">Cleiton</text>
</svg>`);
  const composites = [];
  if (roundedAvatar) composites.push({ input: roundedAvatar, left: 92, top: 232 });
  if (cleiton) {
    const cleitonThumb = await roundedImage(cleiton, 118).catch(() => null);
    if (cleitonThumb) composites.push({ input: cleitonThumb, left: 974, top: 82 });
  }
  return sharp(svg).composite(composites).jpeg({ quality: 92 }).toBuffer();
}

async function rankGraphicBuffer(items, groupName) {
  const max = Math.max(...items.map((item) => item.value), 1);
  const bars = items.map((item, index) => {
    const y = 186 + index * 67;
    const width = Math.max(34, Math.round((item.value / max) * 500));
    return `
      <text x="92" y="${y + 28}" fill="#e5e7eb" font-size="23" font-family="Arial, sans-serif" font-weight="700">${index + 1}. ${escapeXml(truncateText(item.label || `Membro ${index + 1}`, 24))}</text>
      <rect x="460" y="${y}" width="530" height="38" rx="19" fill="#122033"/>
      <rect x="460" y="${y}" width="${width}" height="38" rx="19" fill="#22c55e"/>
      <text x="1030" y="${y + 27}" fill="#ffffff" font-size="22" font-family="Arial, sans-serif" font-weight="700" text-anchor="end">${item.value}</text>`;
  }).join('');
  const svg = Buffer.from(`
<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#052e2b"/></linearGradient></defs>
  <rect width="1200" height="675" rx="38" fill="url(#bg)"/>
  <rect x="54" y="48" width="1092" height="579" rx="34" fill="#020617" opacity=".55" stroke="#ffffff" stroke-opacity=".12"/>
  <text x="88" y="112" fill="#86efac" font-size="30" font-family="Arial, sans-serif" font-weight="700">RANK DO CLEITON</text>
  <text x="88" y="153" fill="#ffffff" font-size="24" font-family="Arial, sans-serif">${escapeXml(truncateText(groupName, 48))}</text>
  ${bars}
  <text x="88" y="598" fill="#d1d5db" font-size="22" font-family="Arial, sans-serif" font-style="italic">Contagem feita pelo Cleiton.</text>
</svg>`);
  return sharp(svg).jpeg({ quality: 92 }).toBuffer();
}

function activityCount(row = {}) {
  return Number(row.messages ?? row.total ?? row.count ?? row.msgs ?? 0) || 0;
}

function rankDisplayName(mention, participant, userId, index) {
  const raw = participantName(participant, userId)
    || mentionNameText(mention?.text || '')
    || contactNameFor(userId)
    || `Membro ${index + 1}`;
  const name = String(raw).replace(/^@/, '').trim();
  if (!name || name.toLowerCase() === 'novo integrante' || name === 'undefined') {
    return maskedRankId(userId, index);
  }
  if (looksLikePhoneName(name)) return maskedRankId(name || userId, index);
  return name;
}

function displayNameForCard(chatId, target, meta = null, message = null, mention = null) {
  const participant = findParticipant(meta, target);
  const typedName = message ? mentionNameFromMessage(message, target) : '';
  const candidates = [
    typedName,
    participantName(participant, target),
    contactNameFor(target, participant?.phoneNumber, participant?.id, participant?.lid, mention?.jid),
    mentionNameText(mention?.text || ''),
    sameParticipant(target, senderJid(message || { key: { remoteJid: chatId } })) ? message?.pushName : ''
  ];
  for (const candidate of candidates) {
    const clean = cleanCardName(candidate);
    if (clean) return clean;
  }
  return maskedRankId(participant?.phoneNumber || mention?.jid || target, 0).replace(/^Membro 1\s*/, 'Membro ');
}

function cleanCardName(value = '') {
  const clean = String(value || '').replace(/^@/, '').trim();
  if (!clean || clean.toLowerCase() === 'novo integrante' || clean.toLowerCase() === 'undefined') return '';
  if (/^membro\s*(\d+)?\s*(\(|$)/i.test(clean)) return '';
  if (looksLikePhoneName(clean)) return '';
  return clean;
}

function maskedRankId(value = '', index = 0) {
  const digits = onlyDigits(value);
  if (digits.length >= 8) return `Membro ${index + 1} (${digits.slice(0, 4)}...${digits.slice(-4)})`;
  return `Membro ${index + 1}`;
}

async function memeBuffer(top, bottom) {
  const cleiton = cleitonImageBuffer();
  const base = cleiton
    ? await sharp(cleiton).resize(900, 900, { fit: 'cover' }).jpeg().toBuffer()
    : await sharp({ create: { width: 900, height: 900, channels: 3, background: '#111827' } }).jpeg().toBuffer();
  const overlay = Buffer.from(`
<svg width="900" height="900" viewBox="0 0 900 900" xmlns="http://www.w3.org/2000/svg">
  <style>
    .meme { font-family: Impact, Arial Black, Arial, sans-serif; font-size: 58px; font-weight: 900; fill: white; stroke: black; stroke-width: 8px; paint-order: stroke; text-anchor: middle; }
  </style>
  <rect width="900" height="900" fill="rgba(0,0,0,.12)"/>
  <text class="meme" x="450" y="84">${escapeXml(truncateText(top, 34))}</text>
  <text class="meme" x="450" y="822">${escapeXml(truncateText(bottom, 34))}</text>
</svg>`);
  return sharp(base).composite([{ input: overlay, left: 0, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
}

async function targetAvatarBuffer(chatId, target, meta = null) {
  const participant = findParticipant(meta, target);
  const mappedPn = await pnForJid(participant?.phoneNumber || participant?.id || participant?.lid || target).catch(() => null);
  const candidates = [
    mappedPn,
    participant?.phoneNumber,
    target,
    participant?.id,
    participant?.lid
  ].filter(Boolean);
  const cached = findMemberProfile(chatId, ...candidates);
  if (cached?.photo_path && existsSync(cached.photo_path)) {
    debugLog('PROFILE_CACHE_PHOTO_HIT', { chat: shortJid(chatId), target: shortJid(target), path: cached.photo_path });
    return readFileSync(cached.photo_path);
  }
  debugLog('TARGET_AVATAR_LOOKUP', {
    target: shortJid(target),
    mappedPn: shortJid(mappedPn || ''),
    participant: shortJid(participant?.id || participant?.lid || ''),
    tries: candidates.length
  });
  const image = await withTimeout(profileImageBuffer(...candidates), 7000, null).catch(() => null);
  if (image) {
    const photoPath = saveProfilePhoto(chatId, mappedPn || participant?.phoneNumber || target, image);
    cacheMemberProfile(chatId, target, meta, { name: cached?.name || '', photoPath, mappedPn });
    return image;
  }
  const mention = mentionFromParticipant(participant, target, mappedPn);
  return diceBearAvatarBuffer(mention.text || target);
}

function cacheMemberProfile(chatId, target, meta = null, { name = '', photoPath = '', mappedPn = '' } = {}) {
  if (!chatId || !target) return null;
  const participant = findParticipant(meta, target);
  const userId = normalizeJid(participant?.id || target);
  const phoneJid = normalizeJid(mappedPn || participant?.phoneNumber || (!isLidJid(userId) ? userId : ''));
  const lidJid = normalizeJid(participant?.lid || (isLidJid(userId) ? userId : ''));
  const cleanName = cleanCardName(name)
    || cleanCardName(participantName(participant, target))
    || cleanCardName(contactNameFor(target, phoneJid, lidJid, userId));
  upsertMemberProfile({ chatId, userId, phoneJid, lidJid, name: cleanName, photoPath });
  debugLog('PROFILE_CACHE_UPSERT', {
    chat: shortJid(chatId),
    user: shortJid(userId),
    phone: shortJid(phoneJid),
    lid: shortJid(lidJid),
    name: cleanName || '',
    hasPhoto: Boolean(photoPath)
  });
  return findMemberProfile(chatId, userId, phoneJid, lidJid, target);
}

function cachedMemberName(chatId, target, meta = null, message = null, mention = null) {
  const participant = findParticipant(meta, target);
  const cached = findMemberProfile(chatId, target, participant?.phoneNumber, participant?.id, participant?.lid, mention?.jid);
  const targetIsSender = message ? sameParticipant(target, senderJid(message)) : false;
  const candidates = [
    mentionNameFromMessage(message || { message: {} }, target),
    cached?.name,
    participantName(participant, target),
    contactNameFor(target, participant?.phoneNumber, participant?.id, participant?.lid, mention?.jid),
    mentionNameText(mention?.text || ''),
    targetIsSender ? cleanContactName(message?.pushName) : ''
  ];
  for (const candidate of candidates) {
    const clean = cleanCardName(candidate);
    if (clean) return clean;
  }
  return '';
}

function cacheMentionNamesFromMessage(chatId, message) {
  const mentions = mentionedJids(message);
  if (!chatId || !mentions.length) return;
  let saved = 0;
  for (const jid of mentions) {
    if (isBotParticipant(jid)) continue;
    const name = cleanCardName(mentionNameFromMessage(message, jid));
    if (!name) continue;
    cacheMemberProfile(chatId, jid, null, { name });
    rememberContactName(jid, name);
    saved += 1;
  }
  if (saved) debugLog('MENTION_NAME_CACHE', { chat: shortJid(chatId), saved });
}

function saveProfilePhoto(chatId, target, buffer) {
  const file = `${onlyDigits(chatId).slice(-14) || 'chat'}-${onlyDigits(target).slice(-18) || Date.now()}.jpg`;
  const path = join(profilePhotoDir, file);
  writeFileSync(path, buffer);
  return path;
}

async function profileCardBuffer(chatId, meta, target, participant, mention, message) {
  const avatar = await roundedImage(await targetAvatarBuffer(chatId, target, meta), 220);
  const name = mentionNameFromMessage(message, target)
    || mentionNameText(mention.text)
    || participantName(participant, target)
    || contactNameFor(target)
    || 'Membro';
  const phone = onlyDigits(await pnForJid(participant?.phoneNumber || target) || target);
  const warnings = getWarningCount(chatId, normalizeJid(participant?.id || target));
  const svg = Buffer.from(`
<svg width="1000" height="560" viewBox="0 0 1000 560" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#064e3b"/></linearGradient></defs>
  <rect width="1000" height="560" rx="36" fill="url(#bg)"/>
  <rect x="46" y="46" width="908" height="468" rx="28" fill="#020617" opacity=".56"/>
  <text x="312" y="130" fill="#86efac" font-size="28" font-family="Arial" font-weight="700">FICHA DO BALCAO</text>
  <text x="312" y="198" fill="#ffffff" font-size="48" font-family="Arial" font-weight="900">${escapeXml(truncateText(name, 24))}</text>
  <text x="312" y="254" fill="#d1fae5" font-size="27" font-family="Arial">${escapeXml(mention.text || 'sem mencao')}</text>
  <text x="312" y="316" fill="#e5e7eb" font-size="25" font-family="Arial">Numero: ${phone ? `+${phone}` : 'oculto'}</text>
  <text x="312" y="358" fill="#e5e7eb" font-size="25" font-family="Arial">Cargo: ${participant?.admin ? 'admin do grupo' : 'membro'}</text>
  <text x="312" y="400" fill="#e5e7eb" font-size="25" font-family="Arial">Advertencias: ${warnings}</text>
  <text x="312" y="462" fill="#cbd5e1" font-size="22" font-family="Arial" font-style="italic">Cleiton conferiu o cracha visual.</text>
</svg>`);
  return sharp(svg).composite([{ input: avatar, left: 66, top: 156 }]).jpeg({ quality: 92 }).toBuffer();
}

async function pollImageBuffer(question, options) {
  const optionRows = options.map((option, index) => {
    const y = 218 + index * 64;
    return `<rect x="90" y="${y}" width="820" height="48" rx="24" fill="#122033"/><text x="122" y="${y + 32}" fill="#ffffff" font-size="24" font-family="Arial" font-weight="700">${index + 1}. ${escapeXml(truncateText(option, 50))}</text>`;
  }).join('');
  const svg = Buffer.from(`
<svg width="1000" height="620" viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#14532d"/></linearGradient></defs>
  <rect width="1000" height="620" rx="36" fill="url(#bg)"/>
  <rect x="50" y="50" width="900" height="520" rx="30" fill="#020617" opacity=".55"/>
  <text x="90" y="116" fill="#86efac" font-size="28" font-family="Arial" font-weight="700">ENQUETE</text>
  <text x="90" y="170" fill="#ffffff" font-size="34" font-family="Arial" font-weight="900">${escapeXml(truncateText(question, 42))}</text>
  ${optionRows}
  <text x="90" y="550" fill="#d1d5db" font-size="22" font-family="Arial" font-style="italic">Responda com o numero. Cleiton conta no olho mesmo.</text>
</svg>`);
  return sharp(svg).jpeg({ quality: 92 }).toBuffer();
}

async function shipCardBuffer(chatId, meta, left, right, percent) {
  const leftAvatar = await roundedImage(await targetAvatarBuffer(chatId, left.avatarTarget || left.jid || left.target, meta), 230);
  const rightAvatar = await roundedImage(await targetAvatarBuffer(chatId, right.avatarTarget || right.jid || right.target, meta), 230);
  const status = percent >= 85 ? 'casal de novela' : percent >= 65 ? 'clima forte' : percent >= 40 ? 'pode render' : 'so amizade por enquanto';
  const svg = Buffer.from(`
<svg width="1100" height="650" viewBox="0 0 1100 650" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#831843"/>
      <stop offset=".46" stop-color="#ec4899"/>
      <stop offset="1" stop-color="#f9a8d4"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="26%" r="75%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".42"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1100" height="650" rx="42" fill="url(#bg)"/>
  <rect width="1100" height="650" rx="42" fill="url(#glow)"/>
  <rect x="58" y="56" width="984" height="538" rx="38" fill="#3b0826" opacity=".52" stroke="#ffffff" stroke-opacity=".16"/>
  <text x="550" y="118" fill="#ffe4f1" font-size="30" font-family="Arial" font-weight="900" text-anchor="middle">CASAL DO CLEITON</text>
  <text x="550" y="168" fill="#ffffff" font-size="25" font-family="Arial" font-style="italic" text-anchor="middle">Cleiton conferiu os olhares e confirmou o romance.</text>
  <circle cx="304" cy="318" r="127" fill="#fbcfe8" opacity=".28"/>
  <circle cx="796" cy="318" r="127" fill="#fbcfe8" opacity=".28"/>
  <text x="550" y="292" fill="#ffffff" font-size="42" font-family="Arial" font-weight="900" text-anchor="middle">♥</text>
  <text x="550" y="368" fill="#ffffff" font-size="92" font-family="Arial" font-weight="900" text-anchor="middle">${percent}%</text>
  <rect x="418" y="392" width="264" height="50" rx="25" fill="#ffffff" opacity=".18"/>
  <text x="550" y="425" fill="#ffe4f1" font-size="24" font-family="Arial" font-weight="800" text-anchor="middle">${escapeXml(status)}</text>
  <text x="92" y="106" fill="#ffffff" opacity=".28" font-size="44" font-family="Arial">♥</text>
  <text x="986" y="530" fill="#ffffff" opacity=".24" font-size="52" font-family="Arial">♥</text>
</svg>`);
  return sharp(svg).composite([{ input: leftAvatar, left: 189, top: 203 }, { input: rightAvatar, left: 681, top: 203 }]).jpeg({ quality: 92 }).toBuffer();
}

async function quizCardBuffer({ title = 'QUIZ DO CLEITON', badge = 'PERGUNTA', question = '', options = [], footer = '' } = {}) {
  const optionRows = options.slice(0, 4).map((option, index) => {
    const y = 300 + index * 74;
    const color = ['#22c55e', '#38bdf8', '#f59e0b', '#f472b6'][index] || '#22c55e';
    return `
      <rect x="88" y="${y - 46}" width="924" height="58" rx="20" fill="#020617" opacity=".62" stroke="${color}" stroke-opacity=".32"/>
      <circle cx="124" cy="${y - 17}" r="20" fill="${color}" opacity=".22"/>
      <text x="124" y="${y - 10}" fill="${color}" font-size="20" font-family="Arial" font-weight="900" text-anchor="middle">${index + 1}</text>
      <text x="164" y="${y - 9}" fill="#ffffff" font-size="24" font-family="Arial" font-weight="800">${escapeXml(truncateText(option, 62))}</text>
    `;
  }).join('');
  const questionLines = wrapText(question, 48).slice(0, 3)
    .map((line, index) => `<text x="88" y="${188 + index * 38}" fill="#ffffff" font-size="32" font-family="Arial" font-weight="900">${escapeXml(line)}</text>`)
    .join('');
  const svg = Buffer.from(`
<svg width="1100" height="650" viewBox="0 0 1100 650" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="#164e63"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity=".36"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1100" height="650" rx="42" fill="url(#bg)"/>
  <rect width="1100" height="650" rx="42" fill="url(#glow)"/>
  <rect x="58" y="56" width="984" height="538" rx="38" fill="#020617" opacity=".58" stroke="#ffffff" stroke-opacity=".10"/>
  <rect x="88" y="90" width="300" height="58" rx="29" fill="#38bdf8" opacity=".18"/>
  <text x="238" y="128" fill="#7dd3fc" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(badge)}</text>
  <text x="410" y="128" fill="#ffffff" font-size="39" font-family="Arial" font-weight="900">${escapeXml(title)}</text>
  ${questionLines}
  ${optionRows}
  <text x="88" y="590" fill="#cbd5e1" font-size="22" font-family="Arial" font-style="italic">${escapeXml(footer || 'Responda com o numero da opcao.')}</text>
</svg>`);
  return sharp(svg).jpeg({ quality: 92 }).toBuffer();
}

async function quizResultCardBuffer({ title = 'RESULTADO', answer = '', detail = '', tone = 'safe' } = {}) {
  const safe = tone === 'safe';
  const color = safe ? '#22c55e' : '#ef4444';
  const glow = safe ? '#064e3b' : '#7f1d1d';
  const answerLines = wrapText(answer, 30).slice(0, 2)
    .map((line, index) => `<text x="88" y="${250 + index * 58}" fill="#ffffff" font-size="50" font-family="Arial" font-weight="900">${escapeXml(line)}</text>`)
    .join('');
  const svg = Buffer.from(`
<svg width="1000" height="560" viewBox="0 0 1000 560" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="${glow}"/>
    </linearGradient>
    <radialGradient id="shine" cx="78%" cy="20%" r="70%">
      <stop offset="0%" stop-color="${color}" stop-opacity=".35"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="560" rx="38" fill="url(#bg)"/>
  <rect width="1000" height="560" rx="38" fill="url(#shine)"/>
  <rect x="54" y="54" width="892" height="452" rx="30" fill="#020617" opacity=".58" stroke="#ffffff" stroke-opacity=".10"/>
  <rect x="88" y="90" width="312" height="58" rx="29" fill="${color}" opacity=".20"/>
  <text x="244" y="128" fill="${color}" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(title)}</text>
  <text x="88" y="200" fill="#cbd5e1" font-size="26" font-family="Arial">Resposta oficial</text>
  ${answerLines}
  <text x="88" y="438" fill="#e5e7eb" font-size="25" font-family="Arial">${escapeXml(detail)}</text>
  <text x="88" y="478" fill="#94a3b8" font-size="22" font-family="Arial" font-style="italic">Cleiton</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 122).catch(() => null) : null;
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 800, top: 340 }] : []).jpeg({ quality: 92 }).toBuffer();
}

async function duelQuizStatusCardBuffer(options = {}) {
  const {
    title = 'DUELOQUIZ',
    badge = 'PLACAR',
    status = 'em andamento',
    left = 'Jogador 1',
    right = 'Jogador 2',
    leftScore = 0,
    rightScore = 0,
    round = 0,
    maxRounds = 3,
    tone = 'start'
  } = options;
  const danger = tone === 'danger';
  const pending = tone === 'pending';
  const accent = danger ? '#ef4444' : pending ? '#f59e0b' : '#22c55e';
  const glow = danger ? '#7f1d1d' : pending ? '#78350f' : '#064e3b';
  const svg = Buffer.from(`
<svg width="1100" height="650" viewBox="0 0 1100 650" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="${glow}"/>
    </linearGradient>
    <radialGradient id="shine" cx="76%" cy="18%" r="70%">
      <stop offset="0%" stop-color="${accent}" stop-opacity=".34"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1100" height="650" rx="42" fill="url(#bg)"/>
  <rect width="1100" height="650" rx="42" fill="url(#shine)"/>
  <rect x="58" y="56" width="984" height="538" rx="38" fill="#020617" opacity=".60" stroke="#ffffff" stroke-opacity=".10"/>
  <rect x="88" y="90" width="250" height="58" rx="29" fill="${accent}" opacity=".20"/>
  <text x="213" y="128" fill="${accent}" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(badge)}</text>
  <text x="550" y="128" fill="#ffffff" font-size="48" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(title)}</text>
  <text x="550" y="188" fill="#dbeafe" font-size="25" font-family="Arial" font-style="italic" text-anchor="middle">${escapeXml(status)}</text>
  <rect x="94" y="246" width="350" height="210" rx="32" fill="#020617" opacity=".52" stroke="#38bdf8" stroke-opacity=".30"/>
  <rect x="656" y="246" width="350" height="210" rx="32" fill="#020617" opacity=".52" stroke="#f472b6" stroke-opacity=".30"/>
  <text x="269" y="320" fill="#ffffff" font-size="34" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(truncateText(left.replace(/^@/, ''), 18))}</text>
  <text x="831" y="320" fill="#ffffff" font-size="34" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(truncateText(right.replace(/^@/, ''), 18))}</text>
  <text x="269" y="406" fill="#38bdf8" font-size="76" font-family="Arial" font-weight="900" text-anchor="middle">${leftScore}</text>
  <text x="831" y="406" fill="#f472b6" font-size="76" font-family="Arial" font-weight="900" text-anchor="middle">${rightScore}</text>
  <text x="550" y="356" fill="#ffffff" font-size="58" font-family="Arial" font-weight="900" text-anchor="middle">X</text>
  <rect x="406" y="490" width="288" height="58" rx="29" fill="${accent}" opacity=".16"/>
  <text x="550" y="528" fill="${accent}" font-size="26" font-family="Arial" font-weight="900" text-anchor="middle">RODADA ${round}/${maxRounds}</text>
  <text x="88" y="585" fill="#94a3b8" font-size="22" font-family="Arial" font-style="italic">Cleiton</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 92).catch(() => null) : null;
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 930, top: 492 }] : []).jpeg({ quality: 92 }).toBuffer();
}

async function rouletteCardBuffer(chatId, meta, options = {}) {
  const {
    title = 'ROLETA RUSSA',
    badge = 'RODADA',
    status = 'tambor girando',
    shooter = '',
    target = '',
    round = 0,
    maxRounds = 6,
    remaining = 6,
    tone = 'start',
    medals = 0
  } = options;
  const danger = tone === 'danger';
  const safe = tone === 'safe';
  const pending = tone === 'pending';
  const leftLabel = danger ? 'PERDEDOR' : pending ? 'DESAFIANTE' : 'TURNO';
  const rightLabel = danger ? 'VENCEDOR' : pending ? 'DESAFIADO' : 'PROXIMO';
  const accent = danger ? '#ef4444' : safe ? '#22c55e' : pending ? '#f59e0b' : '#38bdf8';
  const glow = danger ? '#7f1d1d' : safe ? '#064e3b' : pending ? '#78350f' : '#164e63';
  const shooterAvatar = await roundedImage(await targetAvatarBuffer(chatId, shooter, meta), 176);
  const targetAvatar = await roundedImage(await targetAvatarBuffer(chatId, target, meta), 176);
  const chambers = Array.from({ length: Number(maxRounds) || 6 }).map((_, index) => {
    const angle = (-90 + index * (360 / (Number(maxRounds) || 6))) * Math.PI / 180;
    const cx = 550 + Math.cos(angle) * 58;
    const cy = 318 + Math.sin(angle) * 58;
    const fired = index < Number(round || 0);
    const current = index === Number(round || 0) - 1;
    const fill = current && danger ? '#ef4444' : fired ? '#f8fafc' : '#172033';
    const opacity = fired ? '.95' : '.62';
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="18" fill="${fill}" opacity="${opacity}" stroke="${accent}" stroke-opacity=".55" stroke-width="3"/>`;
  }).join('');
  const statLines = [
    ['Rodada', `${round}/${maxRounds}`],
    ['Restam', String(remaining)],
    ['Medalhas', String(medals)]
  ].map(([key, value], index) => {
    const x = 390 + index * 110;
    return `<text x="${x}" y="510" fill="#94a3b8" font-size="20" font-family="Arial" font-weight="700" text-anchor="middle">${key}</text><text x="${x}" y="546" fill="#ffffff" font-size="30" font-family="Arial" font-weight="900" text-anchor="middle">${value}</text>`;
  }).join('');
  const svg = Buffer.from(`
<svg width="1100" height="650" viewBox="0 0 1100 650" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="${glow}"/>
    </linearGradient>
    <radialGradient id="glow" cx="52%" cy="30%" r="70%">
      <stop offset="0%" stop-color="${accent}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1100" height="650" rx="42" fill="url(#bg)"/>
  <rect width="1100" height="650" rx="42" fill="url(#glow)"/>
  <rect x="58" y="56" width="984" height="538" rx="38" fill="#020617" opacity=".62" stroke="#ffffff" stroke-opacity=".10"/>

  <text x="550" y="112" fill="#ffffff" font-size="43" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(truncateText(title, 25))}</text>
  <rect x="400" y="132" width="300" height="48" rx="24" fill="${accent}" opacity=".18"/>
  <text x="550" y="164" fill="${accent}" font-size="24" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(truncateText(badge, 22))}</text>
  <text x="550" y="210" fill="#dbeafe" font-size="24" font-family="Arial" font-style="italic" text-anchor="middle">${escapeXml(truncateText(status, 34))}</text>

  <rect x="143" y="222" width="178" height="40" rx="20" fill="${accent}" opacity=".18"/>
  <rect x="783" y="222" width="178" height="40" rx="20" fill="${accent}" opacity=".18"/>
  <text x="232" y="248" fill="${accent}" font-size="20" font-family="Arial" font-weight="900" text-anchor="middle">${leftLabel}</text>
  <text x="872" y="248" fill="${accent}" font-size="20" font-family="Arial" font-weight="900" text-anchor="middle">${rightLabel}</text>
  <rect x="112" y="270" width="232" height="232" rx="116" fill="#111827" stroke="${accent}" stroke-opacity=".48" stroke-width="5"/>
  <rect x="756" y="270" width="232" height="232" rx="116" fill="#111827" stroke="${accent}" stroke-opacity=".48" stroke-width="5"/>

  <circle cx="550" cy="318" r="106" fill="#050816" stroke="${accent}" stroke-width="6" stroke-opacity=".72"/>
  <circle cx="550" cy="318" r="44" fill="#111827" stroke="#f8fafc" stroke-opacity=".25" stroke-width="4"/>
  ${chambers}
  <circle cx="550" cy="318" r="22" fill="${accent}" opacity=".24"/>
  <circle cx="550" cy="318" r="12" fill="#f8fafc" opacity=".75"/>
  <rect x="365" y="470" width="370" height="86" rx="28" fill="#020617" opacity=".46" stroke="${accent}" stroke-opacity=".22"/>
  ${statLines}
  <rect x="505" y="395" width="90" height="42" rx="21" fill="${accent}" opacity=".18"/>
  <text x="550" y="424" fill="${accent}" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">.38</text>
  <text x="550" y="588" fill="#94a3b8" font-size="22" font-family="Arial" font-style="italic" text-anchor="middle">Cleiton</text>
</svg>`);
  return sharp(svg)
    .composite([
      { input: shooterAvatar, left: 140, top: 298 },
      { input: targetAvatar, left: 784, top: 298 }
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function rouletteTutorialCardBuffer() {
  const rows = [
    ['1', 'Desafie alguem', `${prefix()}roletarussa @pessoa`],
    ['2', 'Resposta do alvo', `${prefix()}roletarussa aceitar ou recusar`],
    ['3', 'Turno aberto', `${prefix()}roletarussa`],
    ['4', 'Rodadas', 'O tambor tem 6 chances'],
    ['5', 'Fim da batalha', 'Quem cair perde e sai do grupo'],
    ['6', 'Medalhas', `${prefix()}roletarussa placar`]
  ].map(([number, title, detail], index) => {
    const y = 196 + index * 68;
    return `
      <rect x="92" y="${y - 42}" width="914" height="56" rx="18" fill="#020617" opacity=".58" stroke="#f59e0b" stroke-opacity=".16"/>
      <circle cx="126" cy="${y - 14}" r="19" fill="#f59e0b" opacity=".24"/>
      <text x="126" y="${y - 7}" fill="#fbbf24" font-size="20" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(number)}</text>
      <text x="164" y="${y - 18}" fill="#ffffff" font-size="26" font-family="Arial" font-weight="900">${escapeXml(title)}</text>
      <text x="164" y="${y + 8}" fill="#cbd5e1" font-size="21" font-family="Arial">${escapeXml(detail)}</text>
    `;
  }).join('');
  const svg = Buffer.from(`
<svg width="1100" height="650" viewBox="0 0 1100 650" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="#78350f"/>
    </linearGradient>
    <radialGradient id="glow" cx="76%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity=".38"/>
      <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1100" height="650" rx="42" fill="url(#bg)"/>
  <rect width="1100" height="650" rx="42" fill="url(#glow)"/>
  <rect x="58" y="56" width="984" height="538" rx="38" fill="#020617" opacity=".62" stroke="#ffffff" stroke-opacity=".10"/>
  <rect x="92" y="90" width="274" height="58" rx="29" fill="#f59e0b" opacity=".20"/>
  <text x="229" y="128" fill="#fbbf24" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">COMO JOGAR</text>
  <text x="390" y="128" fill="#ffffff" font-size="40" font-family="Arial" font-weight="900">ROLETA RUSSA</text>
  <text x="92" y="174" fill="#dbeafe" font-size="23" font-family="Arial" font-style="italic">Desafio, aceite, turnos e medalhas no chat.</text>
  ${rows}
  <text x="92" y="585" fill="#94a3b8" font-size="22" font-family="Arial" font-style="italic">Cleiton</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 108).catch(() => null) : null;
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 910, top: 462 }] : []).jpeg({ quality: 92 }).toBuffer();
}

async function effectCardBuffer(command, avatarBuffer, label) {
  const titles = {
    wanted: ['PROCURADO', 'Recompensa: um cafe'],
    wasted: ['WASTED', 'Encontrado no corredor do Cleiton'],
    preso: ['FICHA CRIMINAL', 'Preso por excesso de resenha']
  };
  const [title, subtitle] = titles[command] || titles.wanted;
  const avatar = await roundedImage(avatarBuffer, 250);
  const svg = Buffer.from(`
<svg width="900" height="900" viewBox="0 0 900 900" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="900" rx="34" fill="${command === 'wasted' ? '#111827' : '#7c4a22'}"/>
  <rect x="58" y="58" width="784" height="784" rx="28" fill="${command === 'wasted' ? '#020617' : '#f5deb3'}" opacity=".88"/>
  <text x="450" y="150" fill="${command === 'wasted' ? '#ef4444' : '#3b2411'}" font-size="74" font-family="Impact, Arial Black, Arial" text-anchor="middle">${title}</text>
  <text x="450" y="500" fill="#111827" font-size="30" font-family="Arial" font-weight="800" text-anchor="middle">${escapeXml(truncateText(label.replace(/^@/, ''), 24))}</text>
  <text x="450" y="710" fill="${command === 'wasted' ? '#cbd5e1' : '#3b2411'}" font-size="30" font-family="Arial" text-anchor="middle">${escapeXml(subtitle)}</text>
  <text x="450" y="770" fill="${command === 'wasted' ? '#94a3b8' : '#5c3a1c'}" font-size="24" font-family="Arial" text-anchor="middle">Cleiton</text>
</svg>`);
  return sharp(svg).composite([{ input: avatar, left: 325, top: 220 }]).jpeg({ quality: 92 }).toBuffer();
}

async function captionImageBuffer(buffer, text) {
  const base = await sharp(buffer).resize(1000, 1000, { fit: 'inside', background: '#111827' }).jpeg().toBuffer();
  const meta = await sharp(base).metadata();
  const width = meta.width || 1000;
  const height = meta.height || 1000;
  const overlay = Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${height - 145}" width="${width}" height="145" fill="rgba(0,0,0,.64)"/>
  <text x="${width / 2}" y="${height - 62}" fill="#ffffff" font-size="44" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(truncateText(text, 34))}</text>
</svg>`);
  return sharp(base).composite([{ input: overlay, left: 0, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
}

async function noticeImageBuffer(title, body, footer) {
  const bodyLines = wrapText(body, 38).slice(0, 5).map((line, i) => `<text x="90" y="${230 + i * 54}" fill="#ffffff" font-size="40" font-family="Arial" font-weight="800">${escapeXml(line)}</text>`).join('');
  const svg = Buffer.from(`
<svg width="1000" height="620" viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#164e63"/></linearGradient></defs>
  <rect width="1000" height="620" rx="36" fill="url(#bg)"/>
  <rect x="52" y="52" width="896" height="516" rx="28" fill="#020617" opacity=".52"/>
  <text x="90" y="126" fill="#86efac" font-size="30" font-family="Arial" font-weight="700">${escapeXml(title)}</text>
  ${bodyLines}
  <text x="90" y="540" fill="#d1d5db" font-size="24" font-family="Arial" font-style="italic">${escapeXml(footer)}</text>
</svg>`);
  return sharp(svg).jpeg({ quality: 92 }).toBuffer();
}

async function sendModerationCard(chatId, title, target, detail, mentions = [], quoted, label = 'moderationCard', avatarTarget = '') {
  const image = await moderationCardBuffer(chatId, title, target, detail, avatarTarget);
  return safeSendMessage(chatId, { image, caption: `${title}: ${target}`, mentions: mentions.filter(Boolean) }, { quoted }, label);
}

async function moderationCardBuffer(chatId, title, target, detail, avatarTarget = '') {
  const danger = /REMOVIDO|ADVERTENCIA|MUTE|FECHADO|REBAIXADO/.test(title);
  const color = danger ? '#ef4444' : '#22c55e';
  const subtitle = danger ? 'Registro restritivo' : 'Registro liberado';
  const cardMeta = avatarTarget && chatId?.endsWith('@g.us')
    ? await withTimeout(sock.groupMetadata(chatId).catch(() => null), 1800, null)
    : null;
  const participant = avatarTarget ? findParticipant(cardMeta, avatarTarget) : null;
  const fallbackName = avatarTarget
    ? cleanCardName(participantName(participant, avatarTarget) || contactNameFor(avatarTarget, participant?.phoneNumber, participant?.id, participant?.lid))
    : '';
  const cleanTarget = cleanCardName(target);
  const cardTarget = fallbackName || cleanTarget || String(target || '');
  const nameSize = cardTarget.length > 22 ? 42 : 50;
  const targetLines = wrapText(String(cardTarget || ''), 22).slice(0, 2)
    .map((line, index) => `<text x="94" y="${220 + index * (nameSize + 8)}" fill="#ffffff" font-size="${nameSize}" font-family="Arial" font-weight="900">${escapeXml(line)}</text>`)
    .join('');
  const detailLines = wrapText(String(detail || ''), 42).slice(0, 2)
    .map((line, index) => `<text x="96" y="${360 + index * 36}" fill="#e5e7eb" font-size="27" font-family="Arial">${escapeXml(line)}</text>`)
    .join('');
  const svg = Buffer.from(`
<svg width="1000" height="560" viewBox="0 0 1000 560" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="${danger ? '#4c0519' : '#064e3b'}"/></linearGradient>
    <radialGradient id="glow" cx="82%" cy="18%" r="70%"><stop offset="0%" stop-color="${color}" stop-opacity=".34"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1000" height="560" rx="36" fill="url(#bg)"/>
  <rect width="1000" height="560" rx="36" fill="url(#glow)"/>
  <rect x="54" y="54" width="892" height="452" rx="30" fill="#020617" opacity=".58" stroke="#ffffff" stroke-opacity=".10"/>
  <rect x="88" y="88" width="310" height="58" rx="29" fill="${color}" opacity=".2"/>
  <text x="243" y="126" fill="${color}" font-size="25" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(title)}</text>
  <text x="94" y="176" fill="#cbd5e1" font-size="23" font-family="Arial" font-style="italic">${escapeXml(subtitle)}</text>
  ${targetLines}
  ${detailLines}
  <rect x="92" y="426" width="505" height="50" rx="25" fill="${color}" opacity=".13"/>
  <rect x="748" y="284" width="178" height="178" rx="89" fill="#0f172a" opacity=".52" stroke="${color}" stroke-opacity=".38" stroke-width="4"/>
  <text x="122" y="459" fill="#d1d5db" font-size="22" font-family="Arial" font-style="italic">Assinado pela Cleiton.</text>
</svg>`);
  let avatar = avatarTarget ? await targetAvatarBuffer(chatId, avatarTarget, cardMeta).catch(() => null) : null;
  if (!avatar) avatar = cleitonImageBuffer();
  const thumb = avatar ? await roundedImage(avatar, 154).catch(() => null) : null;
  const cleiton = avatarTarget ? cleitonImageBuffer() : null;
  const seal = cleiton ? await roundedImage(cleiton, 54).catch(() => null) : null;
  const composites = [];
  if (thumb) composites.push({ input: thumb, left: 760, top: 296 });
  if (seal) composites.push({ input: seal, left: 864, top: 404 });
  return sharp(svg).composite(composites).jpeg({ quality: 92 }).toBuffer();
}

async function statusCardBuffer(rows) {
  const rowSvg = rows.map(([key, value], index) => {
    const y = 190 + index * 42;
    return `<text x="92" y="${y}" fill="#d1d5db" font-size="25" font-family="Arial">${escapeXml(key)}</text><text x="430" y="${y}" fill="#ffffff" font-size="25" font-family="Arial" font-weight="800">${escapeXml(value)}</text>`;
  }).join('');
  const svg = Buffer.from(`
<svg width="1000" height="620" viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#064e3b"/></linearGradient></defs>
  <rect width="1000" height="620" rx="36" fill="url(#bg)"/>
  <rect x="54" y="54" width="892" height="512" rx="30" fill="#020617" opacity=".56"/>
  <text x="88" y="122" fill="#86efac" font-size="31" font-family="Arial" font-weight="900">STATUS DO CLEITON</text>
  ${rowSvg}
  <text x="88" y="526" fill="#d1d5db" font-size="23" font-family="Arial" font-style="italic">Cleiton online.</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 128).catch(() => null) : null;
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 760, top: 380 }] : []).jpeg({ quality: 92 }).toBuffer();
}

async function rulesCardBuffer(text) {
  const lines = wrapText(text.replace(/[🚨📌]/g, '').replace(/\s+/g, ' '), 48).slice(0, 9);
  const body = lines.map((line, i) => `<text x="96" y="${190 + i * 40}" fill="#ffffff" font-size="25" font-family="Arial" font-weight="700">${escapeXml(line)}</text>`).join('');
  const svg = Buffer.from(`
<svg width="1000" height="620" viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#064e3b"/></linearGradient></defs>
  <rect width="1000" height="620" rx="36" fill="url(#bg)"/>
  <rect x="54" y="54" width="892" height="512" rx="30" fill="#020617" opacity=".55"/>
  <text x="92" y="124" fill="#86efac" font-size="32" font-family="Arial" font-weight="900">REGRAS DA TROPA</text>
  ${body}
  <text x="92" y="536" fill="#d1d5db" font-size="22" font-family="Arial" font-style="italic">Cleiton confirmou: lealdade, humildade e respeito.</text>
</svg>`);
  return sharp(svg).jpeg({ quality: 92 }).toBuffer();
}

async function ownerCardBuffer() {
  const svg = Buffer.from(`
<svg width="1000" height="560" viewBox="0 0 1000 560" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="#064e3b"/>
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#22c55e" stop-opacity=".38"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="560" rx="36" fill="url(#bg)"/>
  <rect width="1000" height="560" rx="36" fill="url(#glow)"/>
  <rect x="54" y="54" width="892" height="452" rx="30" fill="#020617" opacity=".58" stroke="#ffffff" stroke-opacity=".12"/>
  <rect x="88" y="88" width="230" height="58" rx="29" fill="#22c55e" opacity=".20"/>
  <text x="203" y="126" fill="#86efac" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">MEU DONO</text>
  <text x="88" y="208" fill="#ffffff" font-size="46" font-family="Arial" font-weight="900">CRIADOR OFC DO BOT</text>
  <text x="88" y="274" fill="#d1fae5" font-size="30" font-family="Arial" font-weight="800">${escapeXml(cleitonProfile.ownerLabel)}</text>
  <text x="88" y="330" fill="#e5e7eb" font-size="26" font-family="Arial">Dono da Cleiton</text>
  <text x="88" y="382" fill="#cbd5e1" font-size="24" font-family="Arial">Bot: ${escapeXml(cleitonProfile.botName)}</text>
  <rect x="88" y="432" width="500" height="50" rx="25" fill="#22c55e" opacity=".14"/>
  <text x="118" y="465" fill="#d1d5db" font-size="22" font-family="Arial" font-style="italic">Registro assinado pelo chat.</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 180).catch(() => null) : null;
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 748, top: 282 }] : []).jpeg({ quality: 92 }).toBuffer();
}

async function reportCardBuffer({ group, members, totalMessages, totalMedia, lines }) {
  const body = [
    ['Grupo', truncateText(group, 30)],
    ['Membros', String(members)],
    ['Mensagens', String(totalMessages)],
    ['Midias', String(totalMedia)]
  ].map(([key, value], i) => `<text x="90" y="${190 + i * 44}" fill="#d1d5db" font-size="25" font-family="Arial">${escapeXml(key)}</text><text x="330" y="${190 + i * 44}" fill="#ffffff" font-size="25" font-family="Arial" font-weight="800">${escapeXml(value)}</text>`).join('');
  const tops = lines.slice(0, 4).map((line, i) => `<text x="90" y="${405 + i * 34}" fill="#e5e7eb" font-size="22" font-family="Arial">${escapeXml(truncateText(line, 58))}</text>`).join('');
  const svg = Buffer.from(`
<svg width="1000" height="620" viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#164e63"/></linearGradient></defs>
  <rect width="1000" height="620" rx="36" fill="url(#bg)"/>
  <rect x="54" y="54" width="892" height="512" rx="30" fill="#020617" opacity=".55"/>
  <text x="88" y="124" fill="#86efac" font-size="32" font-family="Arial" font-weight="900">RELATORIO</text>
  ${body}
  <text x="90" y="360" fill="#86efac" font-size="25" font-family="Arial" font-weight="800">Top registrados</text>
  ${tops}
</svg>`);
  return sharp(svg).jpeg({ quality: 92 }).toBuffer();
}

async function playStatsCardBuffer(media = {}) {
  const coverSource = media.thumbnail ? await fetchBuffer(media.thumbnail, 10000).catch(() => null) : null;
  const artistSource = media.artistIcon ? await fetchBuffer(media.artistIcon, 10000).catch(() => null) : null;
  const cleiton = cleitonImageBuffer();
  const cover = await roundedRectImage(coverSource || cleiton, 292, 292, 28).catch(() => null);
  const artist = await roundedImage(artistSource || coverSource || cleiton, 96).catch(() => null);
  const titleLines = wrapText(media.title || 'Musica encontrada', 22).slice(0, 2)
    .map((line, index) => `<text x="430" y="${156 + index * 42}" fill="#ffffff" font-size="37" font-family="Arial" font-weight="900">${escapeXml(line)}</text>`)
    .join('');
  const rows = [
    ['Cantor', media.singer || 'nao informado'],
    ['Duracao', media.duration || 'nao informado'],
    ['Banda/Canal', media.band || media.channel || 'nao informado'],
    ['Views', media.views ? compactNumber(media.views) : 'nao informado']
  ].map(([key, value], index) => {
    const y = 292 + index * 48;
    return `<text x="430" y="${y}" fill="#a7f3d0" font-size="23" font-family="Arial" font-weight="800">${escapeXml(key)}</text><text x="610" y="${y}" fill="#ffffff" font-size="24" font-family="Arial" font-weight="800">${escapeXml(truncateText(value, 26))}</text>`;
  }).join('');
  const svg = Buffer.from(`
<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#083344"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
    <radialGradient id="glow" cx="76%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#22c55e" stop-opacity=".45"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" rx="42" fill="url(#bg)"/>
  <rect width="1200" height="675" rx="42" fill="url(#glow)"/>
  <rect x="54" y="54" width="1092" height="567" rx="36" fill="#020617" opacity=".55" stroke="#ffffff" stroke-opacity=".12"/>
  <rect x="104" y="92" width="260" height="58" rx="29" fill="#22c55e" opacity=".20"/>
  <text x="234" y="130" fill="#86efac" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">PLAY DO CLEITON</text>
  <rect x="430" y="104" width="520" height="118" rx="24" fill="#020617" opacity=".20"/>
  ${titleLines}
  <text x="430" y="246" fill="#d1fae5" font-size="25" font-family="Arial">Ficha da faixa antes do audio chegar no chat.</text>
  ${rows}
  <rect x="430" y="505" width="610" height="54" rx="27" fill="#22c55e" opacity=".16"/>
  <text x="462" y="541" fill="#dcfce7" font-size="23" font-family="Arial" font-weight="800">Audio em MP3, sem playlist, registrado pelo Cleiton.</text>
  <text x="1000" y="610" fill="#d1d5db" font-size="22" font-family="Arial" font-style="italic" text-anchor="end">Cleiton</text>
</svg>`);
  const composites = [];
  if (cover) composites.push({ input: cover, left: 88, top: 214 });
  if (artist) composites.push({ input: artist, left: 982, top: 112 });
  return sharp(svg).composite(composites).jpeg({ quality: 92 }).toBuffer();
}

async function shortcutMenuCardBuffer(title, subtitle, items = []) {
  const rows = items.slice(0, 6).map((item, index) => {
    const y = 184 + index * 66;
    return `
      <rect x="88" y="${y - 42}" width="720" height="54" rx="18" fill="#0f172a" opacity=".72" stroke="#ffffff" stroke-opacity=".08"/>
      <rect x="104" y="${y - 32}" width="36" height="36" rx="18" fill="#22c55e" opacity=".22"/>
      <text x="122" y="${y - 8}" fill="#86efac" font-size="20" font-family="Arial" font-weight="900" text-anchor="middle">${index + 1}</text>
      <text x="160" y="${y - 14}" fill="#ffffff" font-size="27" font-family="Arial" font-weight="900">${escapeXml(item.label)}</text>
      <text x="160" y="${y + 12}" fill="#cbd5e1" font-size="20" font-family="Arial">${escapeXml(item.detail)}</text>
      <text x="770" y="${y - 2}" fill="#86efac" font-size="23" font-family="Arial" font-weight="900" text-anchor="end">${escapeXml(prefix() + item.command)}</text>
    `;
  }).join('');
  const svg = Buffer.from(`
<svg width="1000" height="620" viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="#064e3b"/>
    </linearGradient>
    <radialGradient id="glow" cx="80%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#22c55e" stop-opacity=".40"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="620" rx="38" fill="url(#bg)"/>
  <rect width="1000" height="620" rx="38" fill="url(#glow)"/>
  <rect x="54" y="54" width="892" height="512" rx="30" fill="#020617" opacity=".58" stroke="#ffffff" stroke-opacity=".12"/>
  <rect x="88" y="88" width="330" height="58" rx="29" fill="#22c55e" opacity=".18"/>
  <text x="253" y="126" fill="#86efac" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(title)}</text>
  <text x="88" y="170" fill="#e5e7eb" font-size="25" font-family="Arial">${escapeXml(subtitle)}</text>
  ${rows}
  <text x="88" y="530" fill="#d1d5db" font-size="22" font-family="Arial" font-style="italic">Escolha pelo comando. Chat do Cleiton aberto.</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 122).catch(() => null) : null;
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 818, top: 404 }] : []).jpeg({ quality: 92 }).toBuffer();
}

async function carouselStyleMenuCardBuffer(items = []) {
  const cards = items.slice(0, 5).map((item, index) => {
    const x = 72 + index * 224;
    const color = ['#22c55e', '#38bdf8', '#f472b6', '#facc15', '#a78bfa'][index] || '#22c55e';
    const labelLines = wrapText(item.label, 11).slice(0, 2)
      .map((line, lineIndex) => `<text x="${x + 92}" y="${236 + lineIndex * 30}" fill="#ffffff" font-size="27" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(line)}</text>`)
      .join('');
    const detailLines = wrapText(item.detail, 16).slice(0, 2)
      .map((line, lineIndex) => `<text x="${x + 92}" y="${318 + lineIndex * 24}" fill="#cbd5e1" font-size="20" font-family="Arial" text-anchor="middle">${escapeXml(line)}</text>`)
      .join('');
    return `
      <rect x="${x}" y="170" width="184" height="300" rx="28" fill="#020617" opacity=".68" stroke="${color}" stroke-opacity=".42" stroke-width="3"/>
      <rect x="${x + 24}" y="198" width="136" height="44" rx="22" fill="${color}" opacity=".18"/>
      ${labelLines}
      ${detailLines}
      <rect x="${x + 24}" y="384" width="136" height="44" rx="22" fill="${color}" opacity=".22"/>
      <text x="${x + 92}" y="413" fill="${color}" font-size="20" font-family="Arial" font-weight="900" text-anchor="middle">${escapeXml(prefix() + item.command)}</text>
    `;
  }).join('');
  const svg = Buffer.from(`
<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="52%" stop-color="#083344"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#22c55e" stop-opacity=".38"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" rx="42" fill="url(#bg)"/>
  <rect width="1200" height="675" rx="42" fill="url(#glow)"/>
  <rect x="54" y="54" width="1092" height="567" rx="36" fill="#020617" opacity=".55" stroke="#ffffff" stroke-opacity=".12"/>
  <rect x="84" y="92" width="330" height="58" rx="29" fill="#22c55e" opacity=".18"/>
  <text x="249" y="130" fill="#86efac" font-size="28" font-family="Arial" font-weight="900" text-anchor="middle">MENU EM VITRINE</text>
  <text x="428" y="130" fill="#ffffff" font-size="38" font-family="Arial" font-weight="900">CLEITON</text>
  ${cards}
  <text x="88" y="565" fill="#d1d5db" font-size="23" font-family="Arial" font-style="italic">Use o comando do card para abrir o setor.</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  const thumb = cleiton ? await roundedImage(cleiton, 104).catch(() => null) : null;
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 1010, top: 500 }] : []).jpeg({ quality: 92 }).toBuffer();
}

async function pingCardBuffer({ latency, messageLag, uptime, usedMb, heapMb }) {
  const status = latency < 80 ? 'RAPIDO' : latency < 180 ? 'OK' : 'LENTO';
  const color = latency < 80 ? '#22c55e' : latency < 180 ? '#facc15' : '#ef4444';
  const svg = Buffer.from(`
<svg width="1000" height="560" viewBox="0 0 1000 560" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="#064e3b"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="20%" r="65%">
      <stop offset="0%" stop-color="${color}" stop-opacity=".45"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="560" rx="36" fill="url(#bg)"/>
  <rect width="1000" height="560" rx="36" fill="url(#glow)"/>
  <rect x="54" y="54" width="892" height="452" rx="30" fill="#020617" opacity=".56" stroke="#ffffff" stroke-opacity=".12"/>
  <text x="88" y="118" fill="#86efac" font-size="30" font-family="Arial, sans-serif" font-weight="700">PING DO CLEITON</text>
  <text x="88" y="194" fill="#ffffff" font-size="82" font-family="Arial, sans-serif" font-weight="900">${latency} ms</text>
  <rect x="705" y="96" width="170" height="58" rx="29" fill="${color}" opacity=".22"/>
  <text x="790" y="134" fill="${color}" font-size="25" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${status}</text>
  <g font-family="Arial, sans-serif" font-size="27" fill="#e5e7eb">
    <text x="92" y="282">Lag da mensagem</text>
    <text x="420" y="282" font-weight="800" fill="#ffffff">${messageLag} ms</text>
    <text x="92" y="336">Uptime</text>
    <text x="420" y="336" font-weight="800" fill="#ffffff">${escapeXml(uptime)}</text>
    <text x="92" y="390">Memoria RSS</text>
    <text x="420" y="390" font-weight="800" fill="#ffffff">${usedMb} MB</text>
    <text x="92" y="444">Heap</text>
    <text x="420" y="444" font-weight="800" fill="#ffffff">${heapMb} MB</text>
  </g>
  <rect x="660" y="415" width="220" height="48" rx="24" fill="#020617" opacity=".35"/>
  <text x="770" y="447" fill="#d1d5db" font-size="20" font-family="Arial, sans-serif" font-style="italic" text-anchor="middle">Motor Baileys</text>
</svg>`);
  const cleiton = cleitonImageBuffer();
  if (!cleiton) return sharp(svg).jpeg({ quality: 92 }).toBuffer();
  const thumb = await roundedImage(cleiton, 120).catch(() => null);
  return sharp(svg).composite(thumb ? [{ input: thumb, left: 796, top: 280 }] : []).jpeg({ quality: 92 }).toBuffer();
}

function wrapText(text = '', max = 36) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function roundedImage(buffer, size) {
  const image = await sharp(buffer).resize(size, size, { fit: 'cover' }).png().toBuffer();
  const mask = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function roundedRectImage(buffer, width, height, radius = 24) {
  const image = await sharp(buffer).resize(width, height, { fit: 'cover' }).png().toBuffer();
  const mask = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`);
  return sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

function cleitonImageBuffer() {
  const candidates = [
    join(process.cwd(), 'public', 'assets', 'cleiton.jpeg'),
    join(process.cwd(), 'public', 'assets', 'cleiton.jpg'),
    join(process.cwd(), 'public', 'assets', 'cleiton.png')
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  return path ? readFileSync(path) : null;
}

function cleanWelcomeName(text = '') {
  const value = String(text || '').replace(/^@/, '').replace(/_/g, ' ').trim();
  if (!value || value.toLowerCase() === 'novo integrante' || onlyDigits(value).length > 9) return '';
  return truncateText(value, 24);
}

function truncateText(text = '', max = 40) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatMusicDuration(value = 0) {
  let total = Number(value) || 0;
  if (!total) return 'nao informado';
  if (total > 36000) total = Math.round(total / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function compactNumber(value = 0) {
  const number = Number(value) || 0;
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

function bestThumbnailUrl(info = {}) {
  const raw = info.thumbnail || info.thumbnailUrl || info.image || info.thumbnails;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const picked = [...raw].filter(Boolean).sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0];
    return typeof picked === 'string' ? picked : picked?.url || '';
  }
  return raw?.url || info.bestThumbnail?.url || '';
}

function bestArtistIconUrl(info = {}) {
  const channel = info.channel || info.author || {};
  const raw = channel.icon || channel.thumbnail || channel.thumbnails || channel.avatar || channel.image;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const picked = [...raw].filter(Boolean).sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0];
    return typeof picked === 'string' ? picked : picked?.url || '';
  }
  return raw?.url || '';
}

function cleanTemp() {
  for (const file of readdirSync(tempDir)) {
    const path = join(tempDir, file);
    const stat = statSync(path);
    if (Date.now() - stat.mtimeMs > 3 * 60 * 60 * 1000) safeUnlink(path);
  }
}

function safeUnlink(path) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
