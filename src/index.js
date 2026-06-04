import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import ffmpegPath from 'ffmpeg-static';
import qrcode from 'qrcode-terminal';
import { GoogleGenAI } from '@google/genai';
import ytdlp from 'yt-dlp-exec';
import { YouTube } from 'youtube-sr';
import pkg from 'whatsapp-web.js';
import {
  addWarningEvent,
  addBlacklist,
  addHistory,
  backupDatabase,
  clearWarnings,
  closeTicket,
  createTicket,
  exportSettingsFile,
  exportSettingsObject,
  getBotRole,
  getWarningCount,
  getActiveMute,
  getSetting,
  getSettings,
  isBlacklisted,
  listBlacklist,
  listBotRoles,
  listMutes,
  listGroups,
  listTickets,
  logEvent,
  muteUser,
  recordActivity,
  recentLogs,
  removeBlacklist,
  removeBotRole,
  seedDefaults,
  setSetting,
  setBotRole,
  topActivity,
  unmuteUser,
  userHistory,
  upsertGroup
} from './db.js';
import { cleitonDefaultSettings, cleitonProfile } from './lara/profile.js';
import { allCatalogCommands, getCategory, getCommandCategory, getMenuCategory } from './menuCatalog.js';

const { Client, LocalAuth, MessageMedia, Poll, List } = pkg;
const catalogCommands = new Set(allCatalogCommands());

process.on('unhandledRejection', (error) => {
  console.error('Erro assíncrono não tratado:', error);
  logEvent({ level: 'error', event: 'unhandled_rejection', message: error?.stack || error?.message || String(error) });
});

process.on('uncaughtException', (error) => {
  console.error('Erro não tratado:', error);
  logEvent({ level: 'error', event: 'uncaught_exception', message: error?.stack || error?.message || String(error) });
});

const defaults = {
  ...cleitonDefaultSettings(),
  BOT_PROMPT: process.env.BOT_PROMPT || cleitonPrompt()
};

seedDefaults(defaults);

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'recepcao-bot' }),
  ffmpegPath,
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

const spamBuckets = new Map();
const mediaBuckets = new Map();
const raidBuckets = new Map();
const x9Seen = new Map();
const mediaQueue = [];
let mediaQueueRunning = false;
let readyHandled = false;
let geminiCooldownUntil = 0;
const downloadDir = join(process.cwd(), 'downloads');
mkdirSync(downloadDir, { recursive: true });
const status = {
  ready: false,
  qr: false,
  startedAt: new Date().toISOString(),
  lastEvent: 'Inicializando a mesa da ouvidoria...'
};
let autoRulesTimer = null;
let autoBackupTimer = null;
let dailyReportTimer = null;
let lastDailyReportDate = '';

client.on('qr', (qr) => {
  status.qr = true;
  status.lastEvent = 'QR Code gerado';
  console.log('\nEscaneie este QR Code com o WhatsApp do numero do bot:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  if (readyHandled) return;
  readyHandled = true;
  status.ready = true;
  status.qr = false;
  status.lastEvent = 'Cleiton da Ouvidoria conectado';
  console.log('Cleiton da Ouvidoria conectado e pronto.');
  logEvent({ event: 'ready', message: 'Bot conectado ao WhatsApp.' });

  const chats = await client.getChats();
  for (const chat of chats.filter((item) => item.isGroup)) upsertGroup(chat);
  disableAutoRulesLoop();
  startAutoBackup();
  startDailyReport();
});

client.on('group_join', async (notification) => {
  try {
    const chat = await notification.getChat();
    if (!shouldHandleChat(chat)) return;
    upsertGroup(chat);

    const welcomeTargets = await getNotificationMentions(notification);
    for (const target of welcomeTargets) {
      if (await isBlacklistedAny(target.ids)) {
        await chat.removeParticipants([target.id]);
        await chat.sendMessage(`Blacklist global acionada: ${target.mentionText} foi barrado na portaria do Cleiton.`, { mentions: [target.contact] });
        logEvent({ level: 'warn', event: 'blacklist_join_removed', chat, userId: target.id });
        return;
      }
    }

    if (await handleAntiRaid(chat, welcomeTargets)) return;

    const names = welcomeTargets.length
      ? welcomeTargets.map((target) => target.mentionText).join(' ')
      : 'Seja bem-vindo(a)';

    await sendWelcomeMessage(chat, names, welcomeTargets);
    logEvent({ event: 'welcome', chat, message: 'Boas-vindas enviadas.' });
  } catch (error) {
    console.error('Erro ao enviar boas-vindas:', error);
  }
});

client.on('message_revoke_everyone', async (message, revokedMsg) => {
  try {
    if (!boolSetting('X9_ENABLED')) return;
    const chat = await message.getChat();
    if (!chat.isGroup || !shouldHandleChat(chat)) return;

    const original = revokedMsg || message;
    const revokeId = original.id?._serialized || message.id?._serialized || `${chat.id._serialized}:${Date.now()}`;
    if (x9Seen.has(revokeId)) return;
    x9Seen.set(revokeId, Date.now());
    cleanupX9Seen();

    const authorId = original.author || message.author || original.from || message.from;
    const body = cleanX9Body(original.body || message.body || '[midia ou mensagem sem texto]');
    await chat.sendMessage([
      '*X9 da Ouvidoria*',
      '',
      `${await displayNameForId(chat, authorId)} apagou uma mensagem:`,
      body.slice(0, 1200)
    ].join('\n'));
    logEvent({ event: 'x9_revoke', chat, userId: authorId, message: body.slice(0, 500) });
  } catch (error) {
    logEvent({ level: 'error', event: 'x9_revoke_error', message: error?.message || String(error) });
  }
});

client.on('message', async (message) => {
  try {
    const chat = await message.getChat();
    if (!chat.isGroup) return handlePrivateMessage(message, chat);

    if (!chat.isGroup || !shouldHandleChat(chat)) return;
    upsertGroup(chat);
    recordActivity(chat.id._serialized, message.author || message.from, message.hasMedia);

    if (!message.body?.startsWith(prefix())) {
      if (await applyAutomaticModeration(message, chat)) return;
      if (shouldAnswerByName(message.body || '') || await isReplyToCleiton(message)) {
        const question = stripCleitonWakeWord(message.body || '');
        await answerWithCleitonAi(message, question);
      }
      return;
    }

    const [rawCommand, ...rest] = message.body.slice(prefix().length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase();
    const args = rest.join(' ').trim();

    if (boolSetting('MAINTENANCE_MODE') && !(await isOwnerMessage(message))) {
      await message.reply('Modo manutencao ativo. So o dono mexe no balcao ate o Cleiton terminar a faxina.');
      return;
    }

    if (command === 'menu' || command === 'ajuda') return sendMenu(message);
    if (getMenuCategory(command)) return sendCategoryMenu(message, command);
    if (command === 'regras') return message.reply(`Regras carimbadas pelo Cleiton:\n\n${rulesText()}`);
    if (command === 'sticker' || command === 'figurinha') return sendSticker(message, chat);
    if (command === 'play' || command === 'musica') return enqueueDownloadedMedia(message, args, 'audio');
    if (command === 'video') return enqueueDownloadedMedia(message, args, 'video');
    if (command === 'todos' || command === 'mention') return mentionEveryone(message, chat, args);
    if (command === 'perfil' || command === 'meustatus') return showProfile(message, chat);
    if (command === 'ping') return message.reply('Pong. Cleiton bateu o carimbo e a mesa ainda esta de pe.');
    if (command === 'calc' || command === 'calcular') return calculateCommand(message, args);
    if (command === 'dono' || command === 'criador') return showOwnerInfo(message);
    if (command === 'infobot' || command === 'statusbot') return showStatus(message, chat);
    if (command === 'statusgp') return showGroupStatus(message, chat);
    if (command === 'warn') return warnMember(message, chat, args);
    if (command === 'advertencias' || command === 'warns') return showWarnings(message, chat);
    if (command === 'limparwarn' || command === 'clearwarn') return clearMemberWarnings(message, chat);
    if (command === 'logs') return showLogs(message, chat);
    if (command === 'mutes') return showMutes(message, chat);
    if (command === 'status') return showStatus(message, chat);
    if (command === 'rank') return showRank(message, chat);
    if (command === 'ouvidoria' || command === 'ticket') return createOuvidoriaTicket(message, chat, args);
    if (command === 'tickets') return showTickets(message, chat);
    if (command === 'fecharticket') return closeOuvidoriaTicket(message, chat, args);
    if (command === 'config') return handleConfigCommand(message, chat, args);
    if (isMenuDesignCommand(command)) return handleMenuDesignCommand(message, command, args);
    if (command === 'addadminbot') return addBotAdmin(message, chat);
    if (command === 'deladminbot' || command === 'removeadminbot') return removeBotAdmin(message, chat);
    if (command === 'addsubdono') return addSubOwner(message, chat);
    if (command === 'delsubdono' || command === 'removesubdono') return removeSubOwner(message, chat);
    if (command === 'cargos') return showBotRoles(message);
    if (command === 'blacklist') return handleBlacklistCommand(message, chat, args);
    if (command === 'backup') return handleBackupCommand(message);
    if (command === 'exportconfig' || command === 'exportarconfig') return handleExportConfigCommand(message);
    if (command === 'restoreconfig' || command === 'restore') return handleRestoreConfigCommand(message, args);
    if (command === 'manutencao') return handleMaintenanceCommand(message, args);
    if (command === 'historico') return showUserHistory(message, chat);
    if (command === 'setwelcome') return setWelcomeImage(message, chat);
    if (command === 'relatorio') return sendDailyReport(true, message);
    if (command === 'bot' || command === 'cleiton') return answerWithCleitonAi(message, args);

    if (['kick', 'ban', 'mute', 'desmute', 'unmute', 'fechargp', 'abrirgp'].includes(command)) {
      return handleModerationCommand(message, chat, command, args);
    }

    if (catalogCommands.has(command)) return handleCatalogCommand(message, chat, command, args);
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
  }
});

client.initialize();
startPanel();

async function handlePrivateMessage(message, chat) {
  if (!message.body?.startsWith(prefix())) {
    if (shouldAnswerByName(message.body || '') || await isReplyToCleiton(message)) {
      const question = stripCleitonWakeWord(message.body || '');
      await answerWithCleitonAi(message, question);
    }
    return;
  }

  const [rawCommand, ...rest] = message.body.slice(prefix().length).trim().split(/\s+/);
  const command = rawCommand?.toLowerCase();
  const args = rest.join(' ').trim();

  if (boolSetting('MAINTENANCE_MODE') && !(await isOwnerMessage(message))) {
    await message.reply('Modo manutencao ativo. No privado tambem so o dono mexe no balcao por enquanto.');
    return;
  }

  if (command === 'menu' || command === 'ajuda') return sendMenu(message);
  if (getMenuCategory(command)) return sendCategoryMenu(message, command);
  if (command === 'sticker' || command === 'figurinha') return sendSticker(message, chat);
  if (command === 'ping') return message.reply('Pong. Privado da ouvidoria respondendo.');
  if (command === 'calc' || command === 'calcular') return calculateCommand(message, args);
  if (command === 'dono' || command === 'criador') return showOwnerInfo(message);
  if (command === 'config') return handleConfigCommand(message, chat, args);
  if (isMenuDesignCommand(command)) return handleMenuDesignCommand(message, command, args);
  if (command === 'status') return showStatus(message, chat);
  if (command === 'backup') return handleBackupCommand(message);
  if (command === 'exportconfig' || command === 'exportarconfig') return handleExportConfigCommand(message);
  if (command === 'restoreconfig' || command === 'restore') return handleRestoreConfigCommand(message, args);
  if (command === 'manutencao') return handleMaintenanceCommand(message, args);
  if (command === 'relatorio') return sendDailyReport(true, message);
  if (command === 'bot' || command === 'cleiton') return answerWithCleitonAi(message, args);
  if (catalogCommands.has(command)) return handleCatalogCommand(message, chat, command, args);

  await sendPrivateMenu(message);
}

async function sendPrivateMenu(message) {
  await sendStatusCard(message, 'Privado do Cleiton', [
    `${prefix()}menu - menu completo`,
    `${prefix()}menufig / ${prefix()}menudown / ${prefix()}menuia`,
    `${prefix()}sticker - envie ou responda imagem/GIF/video curto`,
    `${prefix()}config chave valor - dono configura o bot`,
    `${prefix()}status - mostra o estado do bot`,
    `${prefix()}calc 2+2 - calculadora simples`,
    `${prefix()}backup - cria backup manual`,
    `${prefix()}manutencao on/off - dono controla manutencao`,
    `${prefix()}bot pergunta - conversar com a IA`
  ].join('\n'), 'No grupo continuam os comandos de moderacao.');
}

async function applyAutomaticModeration(message, chat) {
  const contact = await message.getContact();
  const authorId = message.author || contact.id?._serialized || message.from;
  const authorIds = await resolveIdentityIds(authorId, contact);

  if (await isBlacklistedAny(authorIds)) {
    await safeDelete(message);
    try {
      await chat.removeParticipants([authorId]);
    } catch (error) {
      logEvent({ level: 'warn', event: 'blacklist_remove_error', chat, userId: authorId, message: error?.message || String(error) });
    }
    logEvent({ level: 'warn', event: 'blacklist_message_removed', chat, userId: authorId });
    return true;
  }

  if (await isAdmin(chat, authorId, contact)) return false;

  const activeMute = getActiveMute(chat.id._serialized, authorId);
  if (activeMute) {
    await safeDelete(message);
    return true;
  }

  if (numberSetting('MAX_TEXT_LENGTH', 1200) > 0 && (message.body || '').length > numberSetting('MAX_TEXT_LENGTH', 1200)) {
    await safeDelete(message);
    const warnings = addWarningEvent(chat.id._serialized, authorId, 'auto', 'texto gigante');
    await message.reply(`Texto gigante detectado. Cleiton arquivou o pergaminho e anotou advertencia ${warnings}.`);
    return true;
  }

  if (boolSetting('ANTIPALAVRAO_ENABLED') && hasBlockedWord(message.body || '')) {
    await safeDelete(message);
    const warnings = addWarningEvent(chat.id._serialized, authorId, 'auto', 'palavra bloqueada');
    await message.reply(`Palavra bloqueada no balcao. Advertencia ${warnings} registrada.`);
    return true;
  }

  if (boolSetting('ANTIFLOOD_MEDIA_ENABLED') && message.hasMedia && isMediaFlood(chat.id._serialized, authorId)) {
    await safeDelete(message);
    const minutes = numberSetting('AUTO_MUTE_MINUTES', 10);
    muteUser(chat.id._serialized, authorId, nowTs() + minutes * 60, 'flood de midia');
    await message.reply(`Flood de midia detectado. Cleiton aplicou ${minutes} minuto(s) de pausa.`);
    return true;
  }

  if (boolSetting('ANTILINK_ENABLED') && hasLink(message.body || '') && !hasAllowedLink(message.body || '')) {
    await safeDelete(message);
    const warnings = addWarningEvent(chat.id._serialized, authorId, 'auto', 'link sem autorizacao');
    await message.reply(`${cleitonLine('antilink')} Ocorrência número ${warnings} registrada no bloquinho da ouvidoria.`);
    logEvent({ level: 'warn', event: 'antilink', chat, userId: authorId, message: message.body });
    return true;
  }

  if (boolSetting('ANTISPAM_ENABLED') && isSpam(chat.id._serialized, authorId)) {
    await safeDelete(message);
    const minutes = numberSetting('AUTO_MUTE_MINUTES', 10);
    muteUser(chat.id._serialized, authorId, nowTs() + minutes * 60, 'spam automático');
    await message.reply(`${cleitonLine('spam')} Silêncio administrativo por ${minutes} minuto(s).`);
    logEvent({ level: 'warn', event: 'antispam_mute', chat, userId: authorId, message: `${minutes} min` });
    return true;
  }

  return false;
}

async function handleModerationCommand(message, chat, command, args) {
  const contact = await message.getContact();
  const senderId = message.author || contact.id?._serialized || message.from;
  if (!(await hasBotAdminPermission(message, chat, contact, senderId))) {
    await message.reply('A ouvidoria informa: só admin pode bater o carimbo vermelho.');
    return;
  }

  if (command === 'fechargp') {
    const ok = await chat.setMessagesAdminsOnly(true);
    await message.reply(ok ? `${cleitonLine('fechar')} Grupo fechado: só a diretoria fala agora.` : 'Não consegui fechar o grupo. O Cleiton precisa ser admin.');
    logEvent({ event: 'close_group', chat, userId: senderId });
    return;
  }

  if (command === 'abrirgp') {
    const ok = await chat.setMessagesAdminsOnly(false);
    await message.reply(ok ? `${cleitonLine('abrir')} Grupo aberto. Falem com responsabilidade, que eu estou de antena.` : 'Não consegui abrir o grupo. O Cleiton precisa ser admin.');
    logEvent({ event: 'open_group', chat, userId: senderId });
    return;
  }

  const targetId = await resolveTargetId(message);
  if (!targetId) {
    await message.reply(`Marque alguém ou responda à mensagem da pessoa. Exemplo: ${prefix()}${command} @pessoa`);
    return;
  }

  if (command === 'mute') {
    const minutes = parseDurationMinutes(args) || 10;
    muteUser(chat.id._serialized, targetId, nowTs() + minutes * 60, args || 'mute manual');
    addHistory(chat.id._serialized, targetId, 'mute_command', senderId, args || 'mute manual');
    await safeReply(message, `${cleitonLine('mute')} ${formatMentionText(targetId)} recebeu ${minutes} minuto(s) de pausa protocolar.`);
    logEvent({ event: 'mute', chat, userId: targetId, message: `${minutes} min` });
    return;
  }

  if (command === 'desmute' || command === 'unmute') {
    unmuteUser(chat.id._serialized, targetId);
    addHistory(chat.id._serialized, targetId, 'unmute_command', senderId);
    await safeReply(message, `Desmute protocolado. ${formatMentionText(targetId)} pode voltar ao balcão sem fita na boca.`);
    logEvent({ event: 'unmute', chat, userId: targetId });
    return;
  }

  const result = await chat.removeParticipants([targetId]);
  const label = command === 'ban' ? 'banido' : 'removido';
  await safeReply(message, `${cleitonLine(command)} ${formatMentionText(targetId)} foi ${label}. Carimbo seco, assinatura tremida.`);
  addHistory(chat.id._serialized, targetId, command, senderId, JSON.stringify(result));
  logEvent({ event: command, chat, userId: targetId, message: JSON.stringify(result) });
}

async function sendMenu(message) {
  await sendStyledMenu(message);
  return;

  const text = [
    'CLEITON DA OUVIDORIA - protocolo aberto',
    '',
    `${prefix()}regras - regras carimbadas`,
    `${prefix()}sticker - imagem vira figurinha`,
    `${prefix()}play nome ou link - envia audio`,
    `${prefix()}video nome ou link - envia video curto`,
    `${prefix()}todos mensagem - marca todo mundo`,
    `${prefix()}perfil @pessoa - mostra perfil do membro`,
    `${prefix()}bot pergunta - falar com a barata atendente`,
    `${prefix()}mute @pessoa 10m - pausa protocolar`,
    `${prefix()}desmute @pessoa - remove o mute`,
    `${prefix()}kick @pessoa - remover do grupo`,
    `${prefix()}ban @pessoa - remover com carimbo vermelho`,
    `${prefix()}fechargp - só admins falam`,
    `${prefix()}abrirgp - libera a conversa`,
    '',
    'Painel local: http://localhost:' + (process.env.PANEL_PORT || 3000)
  ].join('\n');

  const media = cleitonMedia();
  if (media) {
    await message.reply(media, undefined, { caption: text });
    return;
  }
  await message.reply(text);
}

async function sendStyledMenu(message) {
  await sendMenuWithMedia(message, 'menu');
}

async function sendMenuCatalog(message) {
  try {
    const chat = await message.getChat();
    const list = new List(
      'Escolha uma categoria abaixo. O Cleiton abre a gaveta certa e mostra o caminho.',
      'Abrir catálogo',
      [
        {
          title: 'Grupo',
          rows: [
            { id: 'menu_regras', title: `${prefix()}regras`, description: 'Mostra as regras da tropa.' },
            { id: 'menu_todos', title: `${prefix()}todos mensagem`, description: 'Marca todos do grupo. Admin.' },
            { id: 'menu_perfil', title: `${prefix()}perfil @pessoa`, description: 'Ficha com foto, telefone e status.' },
            { id: 'menu_rank', title: `${prefix()}rank`, description: 'Ranking dos membros mais ativos.' }
          ]
        },
        {
          title: 'Mídia',
          rows: [
            { id: 'menu_sticker', title: `${prefix()}sticker`, description: 'Imagem, GIF ou vídeo curto vira figurinha.' },
            { id: 'menu_play', title: `${prefix()}play nome`, description: 'Baixa e envia áudio.' },
            { id: 'menu_video', title: `${prefix()}video nome`, description: 'Baixa e envia vídeo curto.' }
          ]
        },
        {
          title: 'Ouvidoria',
          rows: [
            { id: 'menu_ia', title: 'cleiton pergunta', description: 'Conversa com o Cleiton sem comando.' },
            { id: 'menu_ticket', title: `${prefix()}ouvidoria motivo`, description: 'Abre um ticket para admins.' },
            { id: 'menu_tickets', title: `${prefix()}tickets`, description: 'Lista tickets abertos. Admin.' }
          ]
        },
        {
          title: 'Admin',
          rows: [
            { id: 'menu_warn', title: `${prefix()}warn @pessoa motivo`, description: 'Registra advertência.' },
            { id: 'menu_mute', title: `${prefix()}mute / ${prefix()}desmute`, description: 'Silencia ou libera membro.' },
            { id: 'menu_ban', title: `${prefix()}kick / ${prefix()}ban`, description: 'Remove membro.' },
            { id: 'menu_config', title: `${prefix()}config`, description: 'Configura o Cleiton pelo WhatsApp.' },
            { id: 'menu_roles', title: `${prefix()}addadminbot / ${prefix()}cargos`, description: 'Permissoes do bot.' },
            { id: 'menu_backup', title: `${prefix()}backup / ${prefix()}exportconfig`, description: 'Backup e configs.' }
          ]
        }
      ],
      'Catálogo do Cleiton',
      'Ouvidoria de papelão, mas com organização.'
    );

    await chat.sendMessage(list);
  } catch (error) {
    logEvent({ level: 'warn', event: 'menu_catalog_error', message: error?.message || String(error) });
    await sendMenuPoll(message);
  }
}

async function sendMenuPoll(message) {
  try {
    const chat = await message.getChat();
    const poll = new Poll('Menu do Cleiton - qual balcao voce quer?', [
      'Grupo: regras, todos, perfil, rank',
      'Midia: sticker, play, video',
      'IA/Ouvidoria: conversa e tickets',
      'Admin: warn, mute, ban, config'
    ], { allowMultipleAnswers: false });

    await chat.sendMessage(poll);
  } catch (error) {
    logEvent({ level: 'warn', event: 'menu_poll_error', message: error?.message || String(error) });
  }
}

function renderMainMenu() {
  return [
    `*${cleitonProfile.botName}*`,
    '_Catalogo oficial da barata do balcao_',
    '',
    '*Menus*',
    `- ${prefix()}menuia - IA e conversa`,
    `- ${prefix()}menudown - downloads`,
    `- ${prefix()}menufig - figurinhas`,
    `- ${prefix()}menuadm - moderacao`,
    `- ${prefix()}menudono - painel do dono`,
    `- ${prefix()}menumemb - membros`,
    `- ${prefix()}ferramentas - utilidades`,
    '',
    '*Extras*',
    `- ${prefix()}menubn - brincadeiras`,
    `- ${prefix()}menulogos - logos`,
    `- ${prefix()}menuedits - edicoes`,
    `- ${prefix()}alteradores - midia`,
    `- ${prefix()}menurpg - RPG/economia`,
    '',
    `Dono: ${cleitonProfile.ownerLabel}`
  ].join('\n');
}

function menuDefinitions() {
  return {
    menuia: {
      title: 'Menu IA',
      rows: [
        ['cleiton pergunta', 'Conversa natural no grupo.'],
        [`${prefix()}bot pergunta`, 'Pergunta direta para a IA.'],
        [`${prefix()}ouvidoria motivo`, 'Abre ticket para a administracao.'],
        [`${prefix()}tickets`, 'Lista tickets abertos.']
      ]
    },
    menudown: {
      title: 'Menu Downloads',
      rows: [
        [`${prefix()}play nome/link`, 'Baixa e envia como audio.'],
        [`${prefix()}video nome/link`, 'Baixa e envia video curto.']
      ]
    },
    menufig: {
      title: 'Menu Figurinhas',
      rows: [
        [`${prefix()}sticker`, 'Imagem, GIF ou video curto vira figurinha.'],
        [`${prefix()}figurinha`, 'Alias do sticker. Funciona no privado tambem.']
      ]
    },
    menuadm: {
      title: 'Menu Admin',
      rows: [
        [`${prefix()}warn @pessoa motivo`, 'Registra advertencia.'],
        [`${prefix()}mute @pessoa 10m`, 'Silencia membro.'],
        [`${prefix()}desmute @pessoa`, 'Remove mute.'],
        [`${prefix()}kick @pessoa`, 'Remove membro.'],
        [`${prefix()}ban @pessoa`, 'Remove com carimbo vermelho.'],
        [`${prefix()}fechargp / ${prefix()}abrirgp`, 'Fecha ou abre o grupo.'],
        [`${prefix()}todos mensagem`, 'Marca todos.']
      ]
    },
    menudono: {
      title: 'Menu Dono',
      rows: [
        [`${prefix()}config chave valor`, 'Configura o bot.'],
        [`${prefix()}addadminbot @pessoa`, 'Da permissao de admin do bot.'],
        [`${prefix()}addsubdono @pessoa`, 'Registra subdono.'],
        [`${prefix()}blacklist add @pessoa motivo`, 'Blacklist global.'],
        [`${prefix()}backup`, 'Backup manual.'],
        [`${prefix()}restoreconfig`, 'Restaura config.'],
        [`${prefix()}manutencao on/off`, 'Trava comandos para o dono.']
      ]
    },
    menumemb: {
      title: 'Menu Membros',
      rows: [
        [`${prefix()}perfil @pessoa`, 'Ficha com foto e informacoes.'],
        [`${prefix()}meustatus`, 'Sua propria ficha.'],
        [`${prefix()}regras`, 'Mostra regras.'],
        [`${prefix()}rank`, 'Ranking de atividade.'],
        [`${prefix()}dono`, 'Mostra o criador do Cleiton.'],
        [`${prefix()}statusgp`, 'Resumo do grupo.']
      ]
    },
    ferramentas: {
      title: 'Menu Ferramentas',
      rows: [
        [`${prefix()}ping`, 'Teste rapido do bot.'],
        [`${prefix()}calc 2+2*5`, 'Calculadora simples.'],
        [`${prefix()}status`, 'Status do bot.'],
        [`${prefix()}relatorio`, 'Resumo para dono/subdono.'],
        [`${prefix()}exportconfig`, 'Exporta configuracoes.']
      ]
    },
    menubn: { title: 'Menu Brincadeiras', rows: [['Brincadeiras', 'Jogos, ranks e zoeiras do grupo.']] },
    menulogos: { title: 'Menu Logos', rows: [['Logos', 'Modelos visuais do Cleiton.']] },
    menulogo: { title: 'Menu Logos', rows: [['Logos', 'Modelos visuais do Cleiton.']] },
    menuedits: { title: 'Menu Edicoes', rows: [['Edicoes', 'Efeitos e edicoes de imagem.']] },
    alteradores: { title: 'Menu Alteradores', rows: [['Midia', 'Alteradores de audio e video.']] },
    menurpg: { title: 'Menu RPG', rows: [['RPG', 'Economia, perfil e aventura.']] },
    menuvip: { title: 'Menu VIP', rows: [['VIP', 'Recursos especiais do balcao.']] }
  };
}

function isMenuCommand(command = '') {
  return Boolean(menuDefinitions()[command]);
}

async function sendCategoryMenu(message, command) {
  const key = getMenuCategory(command) || command;
  await sendMenuWithMedia(message, key);
}

async function sendMenuWithMedia(message, key) {
  const category = getCategory(key) || getCategory('menu');
  const userName = await messagePushName(message);
  const caption = readMorePrefix() + renderCatalogMenu(category, userName);
  const media = cleitonMedia();
  if (media) {
    await message.reply(media, undefined, { caption });
    return;
  }
  await message.reply(caption);
}

function renderCatalogMenu(category, userName) {
  const design = menuDesign(userName);
  const lines = [
    design.header,
    '',
    `${design.menuTopBorder}${design.separatorIcon} *${category.title}*`
  ];

  for (const command of category.commands || []) {
    lines.push(`${design.middleBorder}${design.menuItemIcon}${prefix()}${command}`);
  }

  lines.push(design.bottomBorder);
  lines.push('');
  lines.push(`_Dono: ${cleitonProfile.ownerLabel} | ${getSetting('BOT_DISPLAY_NAME', cleitonProfile.botName)}_`);
  return lines.join('\n');
}

function menuDesign(userName = 'usuario') {
  const botName = getSetting('BOT_DISPLAY_NAME', cleitonProfile.botName);
  const header = getSetting(
    'MENU_HEADER',
    `╭┈⊰ 🪳 『 *{botName}* 』\n┊Olá, {userName}!\n╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯`
  );

  return {
    header: header.replaceAll('{botName}', botName).replaceAll('{userName}', userName),
    menuTopBorder: getSetting('MENU_TOP_BORDER', '╭┈'),
    bottomBorder: getSetting('MENU_BOTTOM_BORDER', '╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯'),
    menuItemIcon: getSetting('MENU_ITEM_ICON', '• protocolo ▸ '),
    separatorIcon: getSetting('MENU_SEPARATOR_ICON', '📎'),
    middleBorder: getSetting('MENU_MIDDLE_BORDER', '┊')
  };
}

function readMorePrefix() {
  if (!boolSetting('MENU_READ_MORE_ENABLED')) return '';
  return '\u200e'.repeat(4001) + '\n';
}

async function messagePushName(message) {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.shortName || 'usuario';
  } catch {
    return 'usuario';
  }
}

async function sendCatalogCommandNotice(message, command) {
  await message.reply(`Cleiton recebeu o protocolo ${prefix()}${command}.`);
}

async function handleCatalogCommand(message, chat, command, args) {
  const category = getCommandCategory(command);

  if (['play2', 'spotify', 'soundcloud'].includes(command)) return enqueueDownloadedMedia(message, args, 'audio');
  if (['playvid', 'tiktok', 'instagram', 'kwai', 'igstory', 'facebook', 'gdrive', 'mediafire', 'twitter', 'pinterest'].includes(command)) {
    return enqueueDownloadedMedia(message, args, 'video');
  }
  if (['sticker2', 'sbg', 'sfundo', 'take', 'rgtake', 'rename'].includes(command)) return sendSticker(message, chat);
  if (['adv'].includes(command)) return warnMember(message, chat, args);
  if (['rmadv'].includes(command)) return clearMemberWarnings(message, chat);
  if (['listadv'].includes(command)) return showWarnings(message, chat);
  if (['marcar', 'hidetag'].includes(command)) return mentionEveryone(message, chat, args);
  if (['closegp', 'grupo'].includes(command)) return handleModerationCommand(message, chat, 'fechargp', args);
  if (['opengp'].includes(command)) return handleModerationCommand(message, chat, 'abrirgp', args);
  if (['addblacklist', 'addblackglobal', 'bangp'].includes(command)) return handleBlacklistCommand(message, chat, `add ${args}`);
  if (['delblacklist', 'rmblackglobal', 'unbangp'].includes(command)) return handleBlacklistCommand(message, chat, `remove ${args}`);
  if (['listblacklist', 'listblackglobal', 'listbangp'].includes(command)) return handleBlacklistCommand(message, chat, 'list');
  if (['prefixo', 'setprefix'].includes(command)) return handleConfigCommand(message, chat, `COMMAND_PREFIX ${args}`);
  if (['nomebot'].includes(command)) return handleConfigCommand(message, chat, `BOT_DISPLAY_NAME ${args}`);
  if (['numerodono'].includes(command)) return showOwnerInfo(message);
  if (['fotomenu', 'fotobot'].includes(command)) return setWelcomeImage(message, chat);
  if (['reiniciar'].includes(command)) return restartFromCommand(message);
  if (['limpardb'].includes(command)) return handleBackupCommand(message);
  if (['rankativo', 'rankativos', 'atividade', 'checkativo', 'topcmd', 'totalcmd'].includes(command)) return showRank(message, chat);
  if (['denunciar'].includes(command)) return createOuvidoriaTicket(message, chat, args || 'denuncia enviada');
  if (['denuncias'].includes(command)) return showTickets(message, chat);
  if (['hora'].includes(command)) return message.reply(`Agora sao ${new Date().toLocaleString('pt-BR')}.`);
  if (['estatisticas'].includes(command)) return showStatus(message, chat);
  if (['dono', 'infovip'].includes(command)) return showOwnerInfo(message);
  if (['ping', 'statusbot'].includes(command)) return showStatus(message, chat);
  if (['statusgp'].includes(command) && chat.isGroup) return showGroupStatus(message, chat);
  if (['toimg'].includes(command)) return message.reply('Envie uma figurinha respondendo com esse comando para converter quando o WhatsApp liberar a midia.');

  if (category === 'menuia') return answerWithCleitonAi(message, args || `${command}: responda de forma curta e util.`);
  if (category === 'menubn') return playfulCommand(message, chat, command, args);
  if (category === 'menurpg') return rpgCommand(message, command, args);
  if (category === 'menulogos') return textArtCommand(message, command, args);
  if (category === 'menuedits' || category === 'alteradores') return mediaUtilityCommand(message, command, args);
  if (category === 'ferramentas') return toolsCommand(message, command, args);
  if (category === 'menudono') return ownerUtilityCommand(message, chat, command, args);
  if (category === 'menuadm') return adminUtilityCommand(message, chat, command, args);
  if (category === 'menufig') return stickerUtilityCommand(message, chat, command, args);
  if (category === 'menumemb') return memberUtilityCommand(message, chat, command, args);

  await sendCatalogCommandNotice(message, command);
}

async function restartFromCommand(message) {
  if (!await ensureOwner(message)) return;
  await message.reply('Reiniciando o balcao da ouvidoria.');
  setTimeout(() => process.exit(0), 800);
}

async function playfulCommand(message, chat, command, args) {
  const targetId = await resolveTargetId(message) || message.author || message.from;
  const percent = stablePercent(`${command}:${targetId}:${new Date().toDateString()}`);
  const target = formatMentionText(targetId);
  const actions = {
    chance: `A chance protocolada deu ${percent}%.`,
    quando: `Quando? Cleiton olhou a agenda e marcou: quando a tropa menos esperar.`,
    sorte: `${target} esta com ${percent}% de sorte hoje.`,
    casal: `O medidor de casal apontou ${percent}% de compatibilidade.`,
    shipo: `Ship protocolado: ${percent}% de chance de virar fofoca oficial.`,
    sn: percent % 2 ? 'Sim.' : 'Nao.',
    piada: 'Piada protocolada: o formulario caiu, mas o Cleiton fingiu que era recurso.',
    charada: 'Charada: o que entra no grupo sem ler regra? Resposta: um futuro advertido.',
    elogio: `${target}, a ouvidoria registrou: presença forte no balcao.`,
    motivacional: 'Respira, bebe agua e segue. Ate barata atravessa chinelo quando tem protocolo.',
    fato: `Fato do dia: ${target} apareceu no radar da ouvidoria com ${percent}% de destaque.`
  };

  if (command.startsWith('rank')) {
    const members = chat.isGroup ? (chat.participants || []).slice(0, 10) : [];
    const shuffled = members.sort((a, b) => stablePercent(`${command}:${a.id?._serialized}`) - stablePercent(`${command}:${b.id?._serialized}`));
    const lines = shuffled.slice(0, 5).map((p, i) => `${i + 1}. ${formatMentionText(p.id?._serialized)} - ${stablePercent(`${command}:${p.id?._serialized}`)}%`);
    return message.reply(lines.length ? lines.join('\n') : `Ranking ${command}: ${percent}% para ${target}.`);
  }

  await message.reply(actions[command] || `${target}: ${percent}% no medidor ${command} da ouvidoria.`);
}

async function rpgCommand(message, command, args) {
  const userId = message.author || message.from;
  const coins = stablePercent(`coins:${userId}`) * 17;
  const level = Math.max(1, Math.floor(stablePercent(`level:${userId}`) / 10));
  if (['carteira', 'perfilrpg', 'meustats'].includes(command)) {
    return sendStatusCard(message, 'Ficha RPG', [
      ['Nivel', String(level)],
      ['Moedas', String(coins)],
      ['Classe', 'Atendente da Ouvidoria']
    ]);
  }
  await message.reply(`${command}: protocolo RPG registrado. Saldo atual: ${coins} moedas.`);
}

async function textArtCommand(message, command, args) {
  const text = args || cleitonProfile.botName;
  await message.reply([
    `*${command.toUpperCase()}*`,
    '',
    `╭━━ ${text} ━━╮`,
    '┃ Carimbo visual do Cleiton ┃',
    '╰━━━━━━━━━━━━╯'
  ].join('\n'));
}

async function mediaUtilityCommand(message, command) {
  let mediaMessage = message;
  if (!message.hasMedia && message.hasQuotedMsg) mediaMessage = await message.getQuotedMessage();
  if (!mediaMessage.hasMedia) return message.reply(`Responda uma midia ou envie com ${prefix()}${command}.`);
  await message.reply(`${command}: midia recebida e protocolada pelo Cleiton.`);
}

async function toolsCommand(message, command, args) {
  if (command === 'calc') return calculateCommand(message, args);
  if (command === 'gerarnick') return message.reply(`Nick protocolado: 『${args || 'Cleiton'}』⚜`);
  if (command === 'qrcode') return message.reply(`QR anotado: ${args || 'envie um texto para gerar'}`);
  if (command === 'nota' || command === 'notas') return createOuvidoriaTicket(message, await message.getChat(), args || 'nota');
  if (['clima', 'dicionario', 'tradutor', 'wikipedia', 'google', 'noticias', 'horoscopo', 'signos'].includes(command)) {
    return answerWithCleitonAi(message, `${command}: ${args || 'responda de forma curta'}`);
  }
  await message.reply(`${command}: protocolo de ferramenta concluido.`);
}

async function ownerUtilityCommand(message, chat, command, args) {
  if (['designmenu', 'setborda', 'setbordafim', 'setbordameio', 'setitem', 'setseparador', 'setheader', 'resetdesign', 'lermais'].includes(command)) {
    return handleMenuDesignCommand(message, command, args);
  }
  if (['addsubdono'].includes(command)) return addSubOwner(message, chat);
  if (['delsubdono'].includes(command)) return removeSubOwner(message, chat);
  if (['listasubdonos'].includes(command)) return showBotRoles(message);
  if (['addcmdvip', 'addpremium', 'addaluguel', 'addsubbot'].includes(command)) return message.reply('Registro adicionado pela ouvidoria.');
  if (['delpremium', 'removeraluguel', 'removesubbot'].includes(command)) return message.reply('Registro removido pela ouvidoria.');
  return sendStatusCard(message, 'Painel do dono', [['Comando', `${prefix()}${command}`], ['Status', 'concluido']]);
}

async function adminUtilityCommand(message, chat, command, args) {
  if (!await ensureAdmin(message, chat)) return;
  if (['promover', 'seradm'].includes(command)) return promoteOrDemote(message, chat, 'promote');
  if (['rebaixar', 'sermembro'].includes(command)) return promoteOrDemote(message, chat, 'demote');
  if (command === 'x9') return toggleGroupFeature(message, 'X9_ENABLED', 'X9');
  if (['limpar', 'del'].includes(command)) return deleteQuotedMessage(message);
  if (['linkgp'].includes(command)) return message.reply('Link do grupo: use o painel do WhatsApp se o Cleiton nao for admin total.');
  if (command === 'antiflood') return toggleGroupFeature(message, 'ANTIFLOOD_MEDIA_ENABLED', 'Antiflood');
  if (['antilinkgp', 'antilinksoft', 'antilinkhard'].includes(command)) return toggleGroupFeature(message, 'ANTILINK_ENABLED', 'Antilink');
  if (['antipalavra', 'antitoxic'].includes(command)) return toggleGroupFeature(message, 'ANTIPALAVRAO_ENABLED', 'Filtro de palavras');
  return message.reply(`${command}: comando administrativo concluido.`);
}

async function deleteQuotedMessage(message) {
  if (!message.hasQuotedMsg) {
    await message.reply(`Responda a mensagem que deseja apagar com ${prefix()}del.`);
    return;
  }

  try {
    const quoted = await message.getQuotedMessage();
    await quoted.delete(true);
    await message.delete(true).catch(() => {});
  } catch {
    await message.reply('Nao consegui apagar. O Cleiton precisa ser admin e a mensagem precisa estar disponivel.');
  }
}

async function toggleGroupFeature(message, key, label) {
  const current = boolSetting(key);
  const next = !current;
  setSetting(key, String(next));
  await message.reply(`${label} ${next ? 'ativado' : 'desativado'}.`);
}

async function stickerUtilityCommand(message, chat, command, args) {
  if (['ttp', 'attp'].includes(command)) {
    return sendTextSticker(message, chat, command, args);
  }
  return sendSticker(message, chat);
}

async function sendTextSticker(message, chat, command, args) {
  let text = args?.trim();
  if (!text && message.hasQuotedMsg) {
    const quoted = await message.getQuotedMessage();
    text = quoted.body?.trim();
  }

  if (!text) {
    await message.reply(`Use assim: ${prefix()}${command} texto da figurinha`);
    return;
  }

  const media = textStickerMedia(text, command);
  await chat.sendMessage(media, {
    sendMediaAsSticker: true,
    stickerAuthor: cleitonProfile.packName,
    stickerName: command === 'attp' ? 'Texto animado' : 'Texto protocolado'
  });
}

function textStickerMedia(text, command) {
  const styles = {
    ttp: { bg: '#ffffff', fg: '#171717', stroke: '#f2c9a7', label: 'OUVIDORIA' },
    attp: { bg: '#111111', fg: '#ffffff', stroke: '#9bffb4', label: 'CLEITON' },
    qc: { bg: '#f5f5f5', fg: '#202020', stroke: '#cfd8dc', label: 'PROTOCOLO' },
    brat: { bg: '#8adf59', fg: '#111111', stroke: '#6ec944', label: 'BRAT' },
    bratvid: { bg: '#8adf59', fg: '#111111', stroke: '#6ec944', label: 'BRAT' },
    emojimix: { bg: '#fff7d6', fg: '#28221a', stroke: '#ffd166', label: 'MIX' }
  };
  const style = styles[command] || styles.ttp;
  const lines = wrapStickerText(text, command === 'brat' || command === 'bratvid' ? 13 : 14).slice(0, 7);
  const fontSize = Math.max(34, Math.min(76, Math.floor(330 / Math.max(1, lines.length))));
  const lineHeight = Math.round(fontSize * 1.12);
  const totalHeight = lines.length * lineHeight;
  const startY = 256 - totalHeight / 2 + fontSize * 0.75;

  const textSvg = lines.map((line, index) => {
    const y = startY + index * lineHeight;
    return `<text x="256" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" fill="${style.fg}" stroke="rgba(0,0,0,.10)" stroke-width="2" paint-order="stroke">${escapeXml(line)}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="72" fill="${style.bg}"/>
  <rect x="18" y="18" width="476" height="476" rx="58" fill="none" stroke="${style.stroke}" stroke-width="10"/>
  <text x="256" y="68" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900" fill="${style.fg}" opacity=".45">${style.label}</text>
  ${textSvg}
  <text x="256" y="470" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${style.fg}" opacity=".35">Cleiton da Ouvidoria</text>
</svg>`;

  return new MessageMedia('image/svg+xml', Buffer.from(svg).toString('base64'), `${command}.svg`);
}

function wrapStickerText(text, maxChars) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';

  for (const word of words) {
    if ((line + ' ' + word).trim().length <= maxChars) {
      line = (line + ' ' + word).trim();
      continue;
    }
    if (line) lines.push(line);
    if (word.length > maxChars) {
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      line = '';
    } else {
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [text.slice(0, maxChars)];
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function memberUtilityCommand(message, chat, command, args) {
  if (['perfil', 'meustatus'].includes(command)) return showProfile(message, chat);
  if (['regras'].includes(command)) return message.reply(`Regras carimbadas pelo Cleiton:\n\n${rulesText()}`);
  if (['mention'].includes(command)) return mentionEveryone(message, chat, args);
  if (['statusbot'].includes(command)) return showStatus(message, chat);
  if (['statusgp'].includes(command)) return showGroupStatus(message, chat);
  if (['rankativo', 'rankativos', 'topcmd'].includes(command)) return showRank(message, chat);
  await message.reply(`${command}: protocolo do membro registrado.`);
}

async function promoteOrDemote(message, chat, action) {
  const targetId = await resolveTargetId(message);
  if (!targetId) return message.reply(`Marque alguem para ${action === 'promote' ? 'promover' : 'rebaixar'}.`);
  try {
    if (action === 'promote') await chat.promoteParticipants([targetId]);
    else await chat.demoteParticipants([targetId]);
    await message.reply(`${formatMentionText(targetId)}: cargo atualizado.`);
  } catch {
    await message.reply('Nao consegui atualizar o cargo. O Cleiton precisa ser admin.');
  }
}

function stablePercent(seed = '') {
  let hash = 0;
  for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash % 101);
}

async function sendCleitonImageText(message, text) {
  const media = cleitonMedia();
  if (media) {
    await message.reply(media, undefined, { caption: text });
    return;
  }
  await message.reply(text);
}

async function calculateCommand(message, args) {
  if (!args) return message.reply(`Use assim: ${prefix()}calc 2+2*5`);
  if (!/^[\d\s+\-*/().,%]+$/.test(args)) {
    return message.reply('A calculadora do Cleiton so aceita numeros e operadores basicos.');
  }

  try {
    const expression = args.replace(/,/g, '.').replace(/%/g, '/100');
    const result = Function(`"use strict"; return (${expression})`)();
    if (!Number.isFinite(Number(result))) throw new Error('resultado invalido');
    await message.reply(`Resultado protocolado: *${result}*`);
  } catch {
    await message.reply('Essa conta fez as antenas do Cleiton darem no. Revise a expressao.');
  }
}

async function showOwnerInfo(message) {
  await sendStatusCard(message, 'Criador do Cleiton', [
    ['Dono', cleitonProfile.ownerLabel],
    ['Bot', cleitonProfile.botName],
    ['Cargo', 'dono maximo do balcao']
  ], 'Numero fixado no protocolo do bot.');
}

async function showGroupStatus(message, chat) {
  if (!chat.isGroup) return message.reply('Esse comando e para grupo. No privado o Cleiton so tem uma cadeira e um balcao.');
  await sendStatusCard(message, 'Status do grupo', [
    ['Grupo', chat.name || 'sem nome'],
    ['Membros', String(chat.participants?.length || 0)],
    ['Mensagens', chat.isReadOnly ? 'somente admins' : 'liberadas'],
    ['Anti-raid', boolSetting('ANTI_RAID_ENABLED') ? 'ativo' : 'desativado'],
    ['Antilink', boolSetting('ANTILINK_ENABLED') ? 'ativo' : 'desativado'],
    ['Antispam', boolSetting('ANTISPAM_ENABLED') ? 'ativo' : 'desativado']
  ]);
}

async function sendSticker(message, chat) {
  let mediaMessage = message;
  if (!message.hasMedia && message.hasQuotedMsg) mediaMessage = await message.getQuotedMessage();

  if (!mediaMessage.hasMedia) {
    await message.reply(`Envie imagem, GIF ou video curto com a legenda ${prefix()}sticker, ou responda uma midia com ${prefix()}sticker.`);
    return;
  }

  const media = await mediaMessage.downloadMedia();
  if (!media || !isStickerMedia(media.mimetype)) {
    await message.reply('A ouvidoria de figurinhas aceita imagem, GIF e video curto. Audio ainda nao vira figurinha, meu consagrado.');
    return;
  }

  if (media.mimetype.startsWith('video/') || media.mimetype === 'image/gif') {
    await message.reply('Cleiton pegou o GIF/video e esta prensando no carimbo animado. Se passar de 5 segundos, o WhatsApp corta a festa.');
  }

  await chat.sendMessage(media, {
    sendMediaAsSticker: true,
    stickerAuthor: cleitonProfile.packAuthor,
    stickerName: 'Protocolo Baratinha'
  });
}

async function enqueueDownloadedMedia(message, args, kind) {
  mediaQueue.push({ message, args, kind });
  const position = mediaQueue.length + (mediaQueueRunning ? 1 : 0);
  if (position > 1) {
    await message.reply(`Pedido entrou na fila da ouvidoria. Posicao: ${position}.`);
  }
  runMediaQueue();
}

async function runMediaQueue() {
  if (mediaQueueRunning) return;
  mediaQueueRunning = true;

  while (mediaQueue.length) {
    const item = mediaQueue.shift();
    await sendDownloadedMedia(item.message, item.args, item.kind);
  }

  mediaQueueRunning = false;
}

async function sendDownloadedMedia(message, args, kind) {
  if (!args) {
    await message.reply(`Protocolo musical incompleto. Use: ${prefix()}${kind === 'audio' ? 'play' : 'video'} nome ou link`);
    return;
  }

  const chat = await message.getChat();
  const query = args.trim();
  const maxDuration = numberSetting('PLAY_MAX_DURATION_SECONDS', 600);
  const maxFileMb = numberSetting('PLAY_MAX_FILE_MB', 45);
  let filePath = '';

  await message.reply(kind === 'audio'
    ? 'Minhas antenas captaram o pedido. Cleiton foi buscar o áudio no almoxarifado.'
    : 'Protocolo de vídeo aberto. Cleiton pegou o carrinho da ouvidoria e foi buscar.');

  try {
    cleanupDownloads();
    const url = await resolveMediaUrl(query);
    const info = await getMediaInfo(url);
    const duration = Number(info.duration || 0);

    if (duration > maxDuration) {
      await message.reply(`Esse protocolo tem ${formatDuration(duration)}. O limite do Cleiton é ${formatDuration(maxDuration)}, porque a barata não aguenta carregar carreta.`);
      return;
    }

    filePath = await downloadMedia(url, kind);
    const sizeMb = statSync(filePath).size / 1024 / 1024;

    if (sizeMb > maxFileMb) {
      unlinkSafe(filePath);
      await message.reply(`Arquivo com ${sizeMb.toFixed(1)} MB. Passou do limite de ${maxFileMb} MB da ouvidoria.`);
      return;
    }

    const title = info.title || 'midia solicitada';
    const media = MessageMedia.fromFilePath(filePath);
    const caption = `${kind === 'audio' ? 'Audio' : 'Video'} protocolado pelo Cleiton: ${title}`.slice(0, 900);
    await chat.sendMessage(media, {
      caption,
      sendAudioAsVoice: false
    });
    logEvent({ event: kind === 'audio' ? 'play_audio' : 'play_video', chat, message: title });
  } catch (error) {
    await message.reply('A ouvidoria tentou buscar a mídia, mas o balcão do download caiu. Tente outro nome ou link.');
    logEvent({ level: 'error', event: kind === 'audio' ? 'play_audio_error' : 'play_video_error', chat, message: error?.stack || error?.message || String(error) });
  } finally {
    if (filePath) unlinkSafe(filePath);
  }
}

async function mentionEveryone(message, chat, args) {
  const contact = await message.getContact();
  const senderId = message.author || contact.id?._serialized || message.from;
  if (!(await hasBotAdminPermission(message, chat, contact, senderId))) {
    logEvent({ level: 'warn', event: 'admin_check_failed', chat, userId: senderId, message: contact.id?._serialized || '' });
    await message.reply('A ouvidoria informa: só admin pode tocar a sirene do !todos.');
    return;
  }

  const contacts = [];
  const mentionLines = [];

  for (const participant of chat.participants || []) {
    const id = participant.id?._serialized;
    if (!id) continue;
    contacts.push(await client.getContactById(id));
    mentionLines.push(`@${id.split('@')[0]}`);
  }

  if (!contacts.length) {
    await message.reply('Cleiton abriu a lista de chamada, mas ela veio vazia. Mistério de repartição.');
    return;
  }

  const text = [
    args || 'Atenção, tropa! Cleiton está chamando todo mundo no balcão da ouvidoria.',
    '',
    mentionLines.join(' ')
  ].join('\n');

  await chat.sendMessage(text, { mentions: contacts });
  logEvent({ event: 'mention_everyone', chat, userId: senderId, message: `${contacts.length} membros` });
}

async function showProfile(message, chat) {
  const quotedContact = message.hasQuotedMsg
    ? await (await message.getQuotedMessage()).getContact()
    : null;
  const targetId = await resolveTargetId(message) || quotedContact?.id?._serialized || message.author || message.from;
  const contact = await client.getContactById(targetId);
  const isTargetAdmin = await isAdmin(chat, targetId, contact);
  const warnings = getWarningCount(chat.id._serialized, targetId);
  const activeMute = getActiveMute(chat.id._serialized, targetId);
  const contactId = contact.id?._serialized || targetId;
  const phoneNumber = contact.number || extractPhoneNumber(contactId) || extractPhoneNumber(targetId) || 'indisponivel';
  const internalId = compactInternalId(targetId, contact.id?._serialized);

  const lines = [
    '*Ficha protocolada pelo Cleiton*',
    '',
    `*Nome:* ${contact.pushname || contact.name || contact.shortName || 'sem cracha no balcao'}`,
    `*Telefone:* ${phoneNumber}`,
    `*ID interno:* ${internalId}`,
    `*Cargo:* ${isTargetAdmin ? 'admin com carimbo' : 'membro da tropa'}`,
    `*Advertencias:* ${warnings}`,
    `*Mute ativo:* ${activeMute ? 'sim' : 'nao'}`
  ];

  if (activeMute) {
    const remaining = Math.max(0, activeMute.until_ts - nowTs());
    lines.push(`*Tempo restante do mute:* ${formatDuration(remaining)}`);
  }

  await sendProfileCard(chat, contact, targetId, lines.join('\n'), quotedContact);
}

async function warnMember(message, chat, args) {
  if (!await ensureAdmin(message, chat)) return;

  const targetId = await resolveTargetId(message);
  if (!targetId) {
    await message.reply(`Marque alguem ou responda a mensagem. Exemplo: ${prefix()}warn @pessoa motivo`);
    return;
  }

  const adminId = message.author || message.from;
  const reason = removeMentionText(args).trim() || 'sem motivo informado';
  const count = addWarningEvent(chat.id._serialized, targetId, adminId, reason);
  await applyWarningPunishment(chat, targetId, count, reason);
  await message.reply(`Advertencia registrada para ${formatMentionText(targetId)}. Total: ${count}. Motivo: ${reason}`);
}

async function showWarnings(message, chat) {
  const targetId = await resolveTargetId(message) || message.author || message.from;
  const count = getWarningCount(chat.id._serialized, targetId);
  await sendStatusCard(message, 'Advertencias', [
    ['Membro', formatMentionText(targetId)],
    ['Total', String(count)]
  ], 'Ficha consultada pela ouvidoria.');
}

async function clearMemberWarnings(message, chat) {
  if (!await ensureAdmin(message, chat)) return;

  const targetId = await resolveTargetId(message);
  if (!targetId) {
    await message.reply(`Marque alguem ou responda a mensagem. Exemplo: ${prefix()}limparwarn @pessoa`);
    return;
  }

  clearWarnings(chat.id._serialized, targetId);
  addHistory(chat.id._serialized, targetId, 'clear_warns', message.author || message.from);
  await message.reply(`Advertencias limpas para ${formatMentionText(targetId)}. Gaveta zerada.`);
}

async function showLogs(message, chat) {
  if (!await ensureAdmin(message, chat)) return;

  const rows = recentLogs(8);
  const text = rows.map((row) => `#${row.id} ${row.level}/${row.event}: ${row.message || row.chat_name || '-'}`).join('\n');
  await sendStatusCard(message, 'Ultimos protocolos', text || 'Sem logs.', 'Somente admins veem essa gaveta.');
}

async function showMutes(message, chat) {
  if (!await ensureAdmin(message, chat)) return;

  const rows = listMutes(chat.id._serialized);
  if (!rows.length) {
    await sendStatusCard(message, 'Mutes ativos', 'Nenhum mute ativo. A gaveta da fita adesiva esta vazia.');
    return;
  }

  const text = rows.map((row) => `${formatMentionText(row.user_id)} - ${formatDuration(row.until_ts - nowTs())} - ${row.reason || 'sem motivo'}`).join('\n');
  await sendStatusCard(message, 'Mutes ativos', text);
}

async function showStatus(message, chat) {
  const uptime = Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000);
  await sendStatusCard(message, 'Status do Cleiton', [
    ['WhatsApp', status.ready ? 'online' : 'offline'],
    ['Uptime', formatDuration(uptime)],
    ['Grupos vistos', String(listGroups().length)],
    ['Gemini', gemini ? 'configurado' : 'sem chave'],
    ['Loop de regras', 'removido'],
    ['Fila de midia', `${mediaQueue.length}${mediaQueueRunning ? ' + 1 em andamento' : ''}`]
  ], 'Painel local: http://localhost:' + (process.env.PANEL_PORT || 3000));
}

async function showRank(message, chat) {
  const rows = topActivity(chat.id._serialized, 10);
  if (!rows.length) {
    await sendStatusCard(message, 'Rank da tropa', 'Ainda nao tem ranking. O contador do Cleiton esta aquecendo.');
    return;
  }

  const lines = [];
  for (const [index, row] of rows.entries()) {
    lines.push(`${index + 1}. ${await displayNameForId(chat, row.user_id)} - ${row.messages} msgs`);
  }
  await sendStatusCard(message, 'Rank da tropa', lines.join('\n'), 'Contagem desde que o ranking foi ativado.');
}

async function createOuvidoriaTicket(message, chat, args) {
  const userId = message.author || message.from;
  const reason = args || 'sem descricao';
  const id = createTicket(chat.id._serialized, userId, reason);
  addHistory(chat.id._serialized, userId, 'ticket_open', userId, reason);
  await message.reply(`Ticket #${id} aberto. Cleiton colocou no bloquinho: ${reason}`);
}

async function showTickets(message, chat) {
  if (!await ensureAdmin(message, chat)) return;

  const rows = listTickets(chat.id._serialized, 'open', 10);
  if (!rows.length) {
    await sendStatusCard(message, 'Tickets abertos', 'Nenhum ticket aberto. A ouvidoria esta estranhamente em paz.');
    return;
  }

  const text = rows.map((row) => `#${row.id} ${formatMentionText(row.user_id)} - ${row.reason || 'sem descricao'}`).join('\n');
  await sendStatusCard(message, 'Tickets abertos', text, 'Use !fecharticket numero para encerrar.');
}

async function closeOuvidoriaTicket(message, chat, args) {
  if (!await ensureAdmin(message, chat)) return;

  const ticketId = Number(args.trim());
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    await message.reply(`Informe o numero. Exemplo: ${prefix()}fecharticket 3`);
    return;
  }

  closeTicket(chat.id._serialized, ticketId);
  addHistory(chat.id._serialized, message.author || message.from, 'ticket_close', message.author || message.from, `#${ticketId}`);
  await message.reply(`Ticket #${ticketId} fechado. Carimbo aplicado.`);
}

async function handleConfigCommand(message, chat, args) {
  if (!await ensureOwner(message)) return;

  const [rawKey, ...rest] = args.split(/\s+/);
  const key = normalizeConfigKey(rawKey || '');
  const value = rest.join(' ').trim();

  if (!key) {
    await sendStatusCard(message, 'Config rapida', [
      `${prefix()}config antilink on/off`,
      `${prefix()}config antispam on/off`,
      `${prefix()}config palavroes on/off`,
      `${prefix()}config whitelist youtube.com,instagram.com`,
      `${prefix()}config antiraid on/off`,
      `${prefix()}config backup on/off`,
      `${prefix()}config relatorio on/off`
    ].join('\n'), 'Somente o dono pode mexer nessa gaveta.');
    return;
  }

  if (!value) {
    await sendStatusCard(message, 'Config atual', [[key, getSetting(key, 'indefinido')]]);
    return;
  }

  setSetting(key, normalizeConfigValue(value));
  if (key === 'AUTO_RULES_ENABLED' || key === 'AUTO_RULES_INTERVAL_MINUTES') disableAutoRulesLoop();
  if (key === 'AUTO_BACKUP_ENABLED' || key === 'AUTO_BACKUP_INTERVAL_MINUTES') startAutoBackup();
  if (key === 'DAILY_REPORT_ENABLED' || key === 'DAILY_REPORT_HOUR') startDailyReport();
  await sendStatusCard(message, 'Config atualizada', [[key, getSetting(key)]], 'Carimbo do dono aplicado.');
}

async function addBotAdmin(message, chat) {
  if (!await ensureSubOwner(message, chat)) return;
  const targetId = await resolveTargetId(message);
  if (!targetId) return message.reply(`Marque alguem. Exemplo: ${prefix()}addadminbot @pessoa`);

  setBotRole(targetId, 'adminbot', message.author || message.from);
  addHistory(chat.id._serialized, targetId, 'addadminbot', message.author || message.from);
  await sendStatusCard(message, 'Cargo aplicado', [
    ['Pessoa', formatMentionText(targetId)],
    ['Cargo', 'admin do bot'],
    ['Permissao', 'pode moderar pelo Cleiton mesmo sem ser admin do grupo']
  ], 'Carimbo da ouvidoria aplicado.');
}

async function removeBotAdmin(message, chat) {
  if (!await ensureSubOwner(message, chat)) return;
  const targetId = await resolveTargetId(message);
  if (!targetId) return message.reply(`Marque alguem. Exemplo: ${prefix()}deladminbot @pessoa`);

  removeBotRole(targetId);
  addHistory(chat.id._serialized, targetId, 'deladminbot', message.author || message.from);
  await message.reply(`Cargo de admin do bot removido de ${formatMentionText(targetId)}. Gaveta devolvida.`);
}

async function addSubOwner(message, chat) {
  if (!await ensureOwner(message)) return;
  const targetId = await resolveTargetId(message);
  if (!targetId) return message.reply(`Marque alguem. Exemplo: ${prefix()}addsubdono @pessoa`);

  setBotRole(targetId, 'subdono', message.author || message.from);
  addHistory(chat.id._serialized, targetId, 'addsubdono', message.author || message.from);
  await sendStatusCard(message, 'Subdono registrado', [
    ['Pessoa', formatMentionText(targetId)],
    ['Cargo', 'subdono'],
    ['Permissao', 'configura funcoes administrativas do bot']
  ], 'Esse carimbo veio da mesa do dono.');
}

async function removeSubOwner(message, chat) {
  if (!await ensureOwner(message)) return;
  const targetId = await resolveTargetId(message);
  if (!targetId) return message.reply(`Marque alguem. Exemplo: ${prefix()}delsubdono @pessoa`);

  removeBotRole(targetId);
  addHistory(chat.id._serialized, targetId, 'delsubdono', message.author || message.from);
  await message.reply(`Subdono removido de ${formatMentionText(targetId)}. Protocolo recolhido.`);
}

async function showBotRoles(message) {
  if (!await ensureOwner(message)) return;
  const rows = listBotRoles();
  if (!rows.length) return sendStatusCard(message, 'Cargos do bot', 'Nenhum cargo extra cadastrado.');

  const text = rows.map((row) => `${formatMentionText(row.user_id)} - ${row.role}`).join('\n');
  await sendStatusCard(message, 'Cargos do bot', text, 'Dono fica acima dessa lista.');
}

async function handleBlacklistCommand(message, chat, args) {
  if (!await ensureSubOwner(message, chat)) return;
  const [actionRaw, ...rest] = args.split(/\s+/);
  const action = (actionRaw || '').toLowerCase();

  if (action === 'list' || action === 'lista') {
    const rows = listBlacklist();
    const text = rows.length
      ? rows.map((row) => `${formatMentionText(row.user_id)} - ${row.reason || 'sem motivo'}`).join('\n')
      : 'Blacklist vazia. A portaria esta tranquila.';
    return sendStatusCard(message, 'Blacklist global', text);
  }

  const targetId = await resolveTargetId(message);
  if (!targetId) {
    return sendStatusCard(message, 'Blacklist', [
      `${prefix()}blacklist add @pessoa motivo`,
      `${prefix()}blacklist remove @pessoa`,
      `${prefix()}blacklist list`
    ].join('\n'));
  }

  if (action === 'add' || action === 'adicionar') {
    const reason = removeMentionText(rest.join(' ')).trim() || 'sem motivo';
    addBlacklist(targetId, reason, message.author || message.from);
    addHistory(chat.id._serialized, targetId, 'blacklist_add', message.author || message.from, reason);
    return message.reply(`Blacklist global atualizada: ${formatMentionText(targetId)} barrado na portaria. Motivo: ${reason}`);
  }

  if (action === 'remove' || action === 'remover' || action === 'del') {
    removeBlacklist(targetId);
    addHistory(chat.id._serialized, targetId, 'blacklist_remove', message.author || message.from);
    return message.reply(`Blacklist removida para ${formatMentionText(targetId)}. Portaria liberada.`);
  }

  await message.reply(`Acao invalida. Use add, remove ou list.`);
}

async function handleBackupCommand(message) {
  if (!await ensureSubOwner(message)) return;
  const result = createBackupFiles();
  await sendStatusCard(message, 'Backup criado', [
    ['Banco', result.dbFile],
    ['Config', result.configFile]
  ], 'Copia guardada na pasta backups.');
}

async function handleExportConfigCommand(message) {
  if (!await ensureSubOwner(message)) return;
  const result = createBackupFiles(false);
  await sendStatusCard(message, 'Export de config', result.configFile, 'JSON salvo na pasta backups.');
}

async function handleRestoreConfigCommand(message, args) {
  if (!await ensureOwner(message)) return;

  let raw = args.trim();
  if (!raw && message.hasQuotedMsg) {
    const quoted = await message.getQuotedMessage();
    raw = quoted.body || '';
  }

  if (!raw) {
    await message.reply(`Envie o caminho do JSON ou responda uma mensagem com JSON. Exemplo: ${prefix()}restoreconfig backups\\config-2026-05-28.json`);
    return;
  }

  try {
    const content = raw.startsWith('{') ? raw : readFileSync(raw, 'utf8');
    const data = JSON.parse(content);
    for (const [key, value] of Object.entries(data)) setSetting(key, value);
    disableAutoRulesLoop();
    startAutoBackup();
    startDailyReport();
    await sendStatusCard(message, 'Config restaurada', `${Object.keys(data).length} item(ns) importados.`, 'Carimbo maximo aplicado.');
  } catch (error) {
    await message.reply(`Nao consegui restaurar a config: ${error.message}`);
  }
}

async function handleMaintenanceCommand(message, args) {
  if (!await ensureOwner(message)) return;
  const value = normalizeConfigValue(args || '');
  if (!['true', 'false'].includes(value)) {
    return sendStatusCard(message, 'Modo manutencao', [
      ['Atual', boolSetting('MAINTENANCE_MODE') ? 'ligado' : 'desligado'],
      ['Uso', `${prefix()}manutencao on/off`]
    ]);
  }

  setSetting('MAINTENANCE_MODE', value);
  await message.reply(value === 'true'
    ? 'Modo manutencao ligado. So o dono usa comandos enquanto o Cleiton mexe nos cabos.'
    : 'Modo manutencao desligado. Balcao liberado de novo.');
}

function isMenuDesignCommand(command = '') {
  return [
    'designmenu', 'verdesign', 'configmenu',
    'setborda', 'setbordatopo', 'settopborder',
    'setbordafim', 'setbottomborder', 'setbordabaixo',
    'setbordameio', 'setmiddleborder', 'setbordamiddle',
    'setitem', 'setitemicon', 'seticoneitem',
    'setseparador', 'setseparatoricon', 'seticoneseparador',
    'setheader', 'setcabecalho', 'setheadermenu',
    'resetdesign', 'resetarmenu', 'resetdesignmenu',
    'lermais'
  ].includes(command);
}

async function handleMenuDesignCommand(message, command, args) {
  if (!await ensureOwner(message)) return;

  const value = args.trim();
  const map = {
    setborda: 'MENU_TOP_BORDER',
    setbordatopo: 'MENU_TOP_BORDER',
    settopborder: 'MENU_TOP_BORDER',
    setbordafim: 'MENU_BOTTOM_BORDER',
    setbottomborder: 'MENU_BOTTOM_BORDER',
    setbordabaixo: 'MENU_BOTTOM_BORDER',
    setbordameio: 'MENU_MIDDLE_BORDER',
    setmiddleborder: 'MENU_MIDDLE_BORDER',
    setbordamiddle: 'MENU_MIDDLE_BORDER',
    setitem: 'MENU_ITEM_ICON',
    setitemicon: 'MENU_ITEM_ICON',
    seticoneitem: 'MENU_ITEM_ICON',
    setseparador: 'MENU_SEPARATOR_ICON',
    setseparatoricon: 'MENU_SEPARATOR_ICON',
    seticoneseparador: 'MENU_SEPARATOR_ICON',
    setheader: 'MENU_HEADER',
    setcabecalho: 'MENU_HEADER',
    setheadermenu: 'MENU_HEADER'
  };

  if (command === 'designmenu' || command === 'verdesign' || command === 'configmenu') {
    const preview = renderCatalogMenu(getCategory('menu'), await messagePushName(message));
    await sendStatusCard(message, 'Design do menu', [
      ['Borda topo', getSetting('MENU_TOP_BORDER', '╭┈')],
      ['Borda meio', getSetting('MENU_MIDDLE_BORDER', '┊')],
      ['Borda fim', getSetting('MENU_BOTTOM_BORDER', '╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯')],
      ['Item', getSetting('MENU_ITEM_ICON', '• protocolo ▸ ')],
      ['Separador', getSetting('MENU_SEPARATOR_ICON', '📎')],
      ['Ler mais', boolSetting('MENU_READ_MORE_ENABLED') ? 'ligado' : 'desligado'],
      '',
      preview.slice(0, 1200)
    ], 'Comandos: setborda, setbordafim, setbordameio, setitem, setseparador, setheader, lermais.');
    return;
  }

  if (command === 'resetdesign' || command === 'resetarmenu' || command === 'resetdesignmenu') {
    setSetting('MENU_TOP_BORDER', '╭┈');
    setSetting('MENU_BOTTOM_BORDER', '╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯');
    setSetting('MENU_MIDDLE_BORDER', '┊');
    setSetting('MENU_ITEM_ICON', '• protocolo ▸ ');
    setSetting('MENU_SEPARATOR_ICON', '📎');
    setSetting('MENU_HEADER', `╭┈⊰ 🪳 『 *{botName}* 』\n┊Olá, {userName}!\n╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯`);
    await message.reply('Design do menu resetado. Cleiton voltou para o carimbo padrao da ouvidoria.');
    return;
  }

  if (command === 'lermais') {
    const normalized = normalizeConfigValue(value || '');
    if (!['true', 'false'].includes(normalized)) {
      await message.reply(`Use: ${prefix()}lermais on/off`);
      return;
    }
    setSetting('MENU_READ_MORE_ENABLED', normalized);
    await message.reply(normalized === 'true' ? 'Ler mais do menu ligado.' : 'Ler mais do menu desligado.');
    return;
  }

  const key = map[command];
  if (!key) return;
  if (!value) {
    await message.reply(`Uso: ${prefix()}${command} <texto>`);
    return;
  }

  setSetting(key, value.replaceAll('\\n', '\n'));
  await message.reply(`Design atualizado: ${key} = ${value}`);
}

async function showUserHistory(message, chat) {
  if (!await ensureBotAdminPermission(message, chat)) return;
  const targetId = await resolveTargetId(message) || message.author || message.from;
  const rows = userHistory(chat.id._serialized, targetId, 12);
  const text = rows.length
    ? rows.map((row) => `#${row.id} ${row.action} - ${row.detail || 'sem detalhe'} - ${row.created_at}`).join('\n')
    : 'Sem historico para esse membro. Ficha limpa ou gaveta nova.';
  await sendStatusCard(message, 'Historico do usuario', [
    ['Usuario', formatMentionText(targetId)],
    text
  ]);
}

async function setWelcomeImage(message, chat) {
  if (!await ensureSubOwner(message, chat)) return;
  let mediaMessage = message;
  if (!message.hasMedia && message.hasQuotedMsg) mediaMessage = await message.getQuotedMessage();
  if (!mediaMessage.hasMedia) return message.reply(`Envie uma imagem com ${prefix()}setwelcome ou responda uma imagem com esse comando.`);

  const media = await mediaMessage.downloadMedia();
  if (!media?.data || !media.mimetype?.startsWith('image/')) return message.reply('A boas-vindas personalizada aceita imagem.');

  const dir = join(process.cwd(), 'public', 'assets', 'welcome');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safeFileName(chat.id._serialized)}.jpeg`);
  writeFileSync(file, Buffer.from(media.data, 'base64'));
  await message.reply('Imagem de boas-vindas salva. Proximo membro novo ja passa pelo mural personalizado.');
}

async function sendProfileCard(chat, contact, targetId, caption, quotedContact = null) {
  try {
    const url = await findProfilePicUrl(contact, targetId, quotedContact);
    if (!url) {
      await chat.sendMessage(`${caption}\n\n_Foto de perfil:_ Cleiton abriu a gaveta e não achou nada.`, { mentions: [contact] });
      return;
    }

    const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
    await chat.sendMessage(media, {
      caption,
      mentions: [contact]
    });
  } catch (error) {
    await chat.sendMessage(`${caption}\n\n_Foto de perfil:_ não consegui acessar. Talvez esteja privada ou o WhatsApp fechou a cortina.`, { mentions: [contact] });
    logEvent({ level: 'warn', event: 'profile_picture_error', chat, userId: targetId, message: error?.message || String(error) });
  }
}

async function findProfilePicUrl(contact, targetId, quotedContact = null) {
  const mappedIds = await getLidPhoneIds([
    targetId,
    contact?.id?._serialized,
    quotedContact?.id?._serialized
  ].filter(Boolean));
  const directIds = [
    targetId,
    contact?.id?._serialized,
    quotedContact?.id?._serialized,
    contact?.number ? `${contact.number}@c.us` : '',
    ...mappedIds
  ].filter(Boolean);

  const tried = [];
  const seenIds = new Set();
  for (const id of directIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    tried.push(id);

    try {
      const url = await client.getProfilePicUrl(id);
      if (url) return url;
    } catch {
      // Try the next ID/contact shape.
    }
  }

  const candidates = [
    contact,
    quotedContact,
    contact?.id?._serialized ? await getContactSafe(contact.id._serialized) : null,
    contact?.number ? await getContactSafe(`${contact.number}@c.us`) : null,
    targetId ? await getContactSafe(targetId) : null,
    ...await Promise.all(mappedIds.map((id) => getContactSafe(id)))
  ].filter(Boolean);

  const seen = new Set();
  for (const candidate of candidates) {
    const id = candidate.id?._serialized;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (id) tried.push(id);

    try {
      const url = await candidate.getProfilePicUrl();
      if (url) return url;
    } catch {
      // Try the next candidate.
    }
  }

  logEvent({ level: 'warn', event: 'profile_picture_not_found', userId: targetId, message: tried.join(', ') });
  return '';
}

async function getLidPhoneIds(ids) {
  try {
    const rows = await client.getContactLidAndPhone(ids);
    return rows.flatMap((row) => [row.lid, row.pn]).filter(Boolean);
  } catch {
    return [];
  }
}

async function getLidPhoneRows(ids) {
  try {
    return await client.getContactLidAndPhone(ids);
  } catch {
    return [];
  }
}

async function getContactSafe(id) {
  try {
    return await client.getContactById(id);
  } catch {
    return null;
  }
}

async function answerWithCleitonAi(message, question) {
  if (!question) {
    await message.reply(`Abra um protocolo: ${prefix()}bot sua pergunta`);
    return;
  }

  if (!gemini) {
    await message.reply('Gemini ainda não está configurado. Coloque GEMINI_API_KEY no .env e reinicie o Cleiton.');
    return;
  }

  if (Date.now() < geminiCooldownUntil) {
    await message.reply('A ouvidoria do Cleiton está sem café de IA por alguns segundos. Tente novamente daqui a pouco.');
    return;
  }

  const models = geminiModels();

  try {
    let response = null;
    let usedModel = models[0];
    let lastError = null;

    for (const model of models) {
      try {
        response = await gemini.models.generateContent({
          model,
          contents: question,
          config: {
            systemInstruction: `${getSetting('BOT_PROMPT', cleitonPrompt())}\n\nRegras do grupo:\n${rulesText()}`,
            temperature: 0.75,
            maxOutputTokens: 1200
          }
        });
        usedModel = model;
        break;
      } catch (error) {
        lastError = error;
        if (!isModelFallbackError(error)) throw error;
      }
    }

    if (!response) throw lastError;
    logEvent({ event: 'gemini_response', message: `Model ${usedModel}` });

    const answer = cleanAiReply(response.text);
    await message.reply(answer || 'A barata piscou, o protocolo caiu. Tente novamente.');
  } catch (error) {
    const statusCode = error?.status || error?.code;
    const errorMessage = error?.message || String(error);
    const retrySeconds = Number(error?.details?.find?.((item) => item.retryDelay)?.retryDelay?.replace('s', '')) || 60;

    if (statusCode === 400 && /API key expired|API_KEY_INVALID/i.test(errorMessage)) {
      await message.reply('A chave do Gemini expirou. A ouvidoria até carimbou o papel, mas o Google recusou a caneta. Gere uma chave nova, atualize o .env e reinicie o Cleiton.');
      logEvent({ level: 'error', event: 'gemini_key_expired', message: 'API key expired' });
      return;
    }

    if (statusCode === 403) {
      await message.reply('O projeto dessa chave não tem permissão para usar esse modelo do Gemini. Verifique o projeto no Google AI Studio ou gere uma chave em outro projeto.');
      logEvent({ level: 'error', event: 'gemini_permission_denied', message: errorMessage });
      return;
    }

    if (statusCode === 429) {
      geminiCooldownUntil = Date.now() + retrySeconds * 1000;
      await message.reply(`O Gemini recusou o protocolo por falta de cota nos modelos configurados (${models.join(', ')}). A chave pode estar certa, mas esse projeto esta sem limite disponivel agora.`);
      logEvent({ level: 'warn', event: 'gemini_quota', message: `Models ${models.join(', ')}; retry in ${retrySeconds}s` });
      return;
    }

    await message.reply('A IA do Cleiton tropeçou no formulário. Tente novamente daqui a pouco.');
    logEvent({ level: 'error', event: 'gemini_error', message: error?.message || String(error) });
  }
}

async function answerWithGemini(message, question) {
  if (!question) {
    await message.reply(`Abra um protocolo: ${prefix()}bot sua pergunta`);
    return;
  }

  if (!gemini) {
    await message.reply('Gemini ainda nao esta configurado. Coloque GEMINI_API_KEY no .env e reinicie o Cleiton.');
    return;
  }

  if (Date.now() < geminiCooldownUntil) {
    await message.reply('A ouvidoria do Cleiton esta sem cafe de IA por alguns segundos. Tenta de novo ja ja.');
    return;
  }

  try {
    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      contents: question,
      config: {
        systemInstruction: `${getSetting('BOT_PROMPT', cleitonPrompt())}\n\nRegras do grupo:\n${rulesText()}`,
        temperature: 0.75,
        maxOutputTokens: 450
      }
    });

    const answer = response.text?.trim();
    await message.reply(answer || 'A barata piscou, o protocolo caiu, tenta de novo.');
  } catch (error) {
    const statusCode = error?.status || error?.code;
    const retrySeconds = Number(error?.details?.find?.((item) => item.retryDelay)?.retryDelay?.replace('s', '')) || 60;

    if (statusCode === 429) {
      geminiCooldownUntil = Date.now() + retrySeconds * 1000;
      await message.reply('O Gemini fechou a portinhola da cota agora. Cleiton registrou o protocolo: sem verba de IA no momento, tenta de novo daqui a pouco.');
      logEvent({ level: 'warn', event: 'gemini_quota', message: `Retry in ${retrySeconds}s` });
      return;
    }

    await message.reply('A IA do Cleiton tropeçou no formulario. Tenta de novo daqui a pouco.');
    logEvent({ level: 'error', event: 'gemini_error', message: error?.message || String(error) });
  }
}

function startPanel() {
  const app = express();
  const port = Number(process.env.PANEL_PORT || 3000);

  app.use(express.json());
  app.use(express.static(join(process.cwd(), 'public')));
  app.get('/api/status', (_req, res) => res.json({ ...status, groups: listGroups().length }));
  app.get('/api/logs', (_req, res) => res.json(recentLogs(100)));
  app.get('/api/groups', (_req, res) => res.json(listGroups()));
  app.get('/api/settings', (_req, res) => res.json(getSettings()));
  app.put('/api/settings/:key', (req, res) => {
    setSetting(req.params.key, req.body.value ?? '');
    logEvent({ event: 'panel_setting_update', message: req.params.key });
    res.json({ ok: true });
  });

  app.listen(port, () => {
    console.log(`Painel do Cleiton: http://localhost:${port}`);
  });
}

function startAutoRules() {
  if (autoRulesTimer) clearInterval(autoRulesTimer);
  autoRulesTimer = null;
  if (getSetting('AUTO_RULES_ENABLED', 'false') !== 'false') {
    setSetting('AUTO_RULES_ENABLED', 'false');
  }
  logEvent({ event: 'auto_rules_disabled', message: 'Loop automatico de regras removido.' });
}

function disableAutoRulesLoop() {
  startAutoRules();
}

function startAutoBackup() {
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  if (!boolSetting('AUTO_BACKUP_ENABLED')) return;

  const intervalMinutes = Math.max(10, numberSetting('AUTO_BACKUP_INTERVAL_MINUTES', 360));
  try {
    const result = createBackupFiles();
    logEvent({ event: 'auto_backup_startup', message: `${result.dbFile}; ${result.configFile}` });
  } catch (error) {
    logEvent({ level: 'error', event: 'auto_backup_startup_error', message: error?.message || String(error) });
  }

  autoBackupTimer = setInterval(() => {
    try {
      const result = createBackupFiles();
      logEvent({ event: 'auto_backup', message: `${result.dbFile}; ${result.configFile}` });
    } catch (error) {
      logEvent({ level: 'error', event: 'auto_backup_error', message: error?.message || String(error) });
    }
  }, intervalMinutes * 60 * 1000);
  logEvent({ event: 'auto_backup_started', message: `${intervalMinutes} min` });
}

function startDailyReport() {
  if (dailyReportTimer) clearInterval(dailyReportTimer);
  if (!boolSetting('DAILY_REPORT_ENABLED')) return;

  dailyReportTimer = setInterval(() => sendDailyReport(false), 30 * 60 * 1000);
  logEvent({ event: 'daily_report_started', message: `${numberSetting('DAILY_REPORT_HOUR', 9)}h` });
}

function createBackupFiles(includeDb = true) {
  const dir = join(process.cwd(), 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const configFile = join(dir, `config-${stamp}.json`);
  const dbFile = join(dir, `cleiton-${stamp}.sqlite`);

  exportSettingsFile(configFile);
  if (includeDb) backupDatabase(dbFile);

  return { configFile, dbFile: includeDb ? dbFile : 'nao solicitado' };
}

async function sendRulesToKnownGroups() {
  if (!status.ready) return;

  try {
    const chats = await client.getChats();
    const groups = chats.filter((chat) => chat.isGroup && shouldHandleChat(chat));

    for (const chat of groups) {
      upsertGroup(chat);
      await chat.sendMessage([
        'Lembrete da Ouvidoria do Cleiton:',
        '',
        'Minhas antenas passaram no mural e acharam bom relembrar as regras da tropa. Leiam com carinho, porque carimbo preventivo evita carimbo vermelho.',
        '',
        rulesText()
      ].join('\n'));
      logEvent({ event: 'auto_rules_sent', chat, message: 'Regras automáticas enviadas.' });
    }
  } catch (error) {
    logEvent({ level: 'error', event: 'auto_rules_error', message: error?.message || String(error) });
  }
}

async function sendWelcomeMessage(chat, names, welcomeTargets) {
  const caption = `${names}\n\n${cleitonLine('boasVindas')}\n\nDa uma olhada nas regras da tropa:\n${rulesText()}`;
  const mentions = welcomeTargets.map((target) => target.contact);
  const imagePath = welcomeImagePath(chat);

  if (imagePath) {
    await chat.sendMessage(MessageMedia.fromFilePath(imagePath), { caption, mentions });
    return;
  }

  await chat.sendMessage(caption, { mentions });
}

function welcomeImagePath(chat) {
  const dir = join(process.cwd(), 'public', 'assets', 'welcome');
  const base = safeFileName(chat.id._serialized);
  for (const ext of ['jpeg', 'jpg', 'png']) {
    const file = join(dir, `${base}.${ext}`);
    if (existsSync(file)) return file;
  }
  return '';
}

async function handleAntiRaid(chat, targets) {
  if (!boolSetting('ANTI_RAID_ENABLED')) return false;

  const now = Date.now();
  const windowMs = numberSetting('ANTI_RAID_WINDOW_SECONDS', 60) * 1000;
  const maxJoins = numberSetting('ANTI_RAID_MAX_JOINS', 5);
  const chatId = chat.id._serialized;
  const bucket = (raidBuckets.get(chatId) || []).filter((time) => now - time <= windowMs);
  for (const _target of targets.length ? targets : [null]) bucket.push(now);
  raidBuckets.set(chatId, bucket);

  if (bucket.length < maxJoins) return false;

  await chat.setMessagesAdminsOnly(true);
  await chat.sendMessage([
    '*Anti-raid ativado*',
    '',
    `Entraram ${bucket.length} membros em ${Math.round(windowMs / 1000)}s.`,
    'Cleiton baixou a portinha do grupo para conter bagunca. Use !abrirgp quando estiver tudo certo.'
  ].join('\n'));
  logEvent({ level: 'warn', event: 'anti_raid_closed_group', chat, message: `${bucket.length} joins` });
  return true;
}

async function sendDailyReport(force = false, replyMessage = null) {
  if (!status.ready) return;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const reportHour = numberSetting('DAILY_REPORT_HOUR', 9);
  if (!force && (now.getHours() !== reportHour || lastDailyReportDate === today)) return;
  lastDailyReportDate = today;

  const report = renderDailyReport();
  if (replyMessage) {
    await sendStatusCard(replyMessage, 'Relatorio diario', report, 'Resumo manual pedido no balcao.');
    return;
  }

  for (const owner of ownerNumbers()) {
    try {
      await client.sendMessage(`${owner}@c.us`, renderStatusCard('Relatorio diario do Cleiton', report, 'Entrega privada para o dono.'));
    } catch (error) {
      logEvent({ level: 'warn', event: 'daily_report_send_error', userId: owner, message: error?.message || String(error) });
    }
  }
}

function renderDailyReport() {
  const logs = recentLogs(50);
  const groups = listGroups();
  const warns = logs.filter((row) => row.event?.includes('warn')).length;
  const moderation = logs.filter((row) => ['antilink', 'antispam_mute', 'kick', 'ban', 'mute', 'blacklist_message_removed', 'anti_raid_closed_group'].includes(row.event)).length;

  return [
    ['Grupos monitorados', String(groups.length)],
    ['Eventos recentes', String(logs.length)],
    ['Moderacao recente', String(moderation)],
    ['Warns recentes', String(warns)],
    ['Mutes ativos vistos', String(listGroups().reduce((total, group) => total + listMutes(group.chat_id).length, 0))],
    ['Manutencao', boolSetting('MAINTENANCE_MODE') ? 'ligada' : 'desligada']
  ];
}

async function resolveTargetId(message) {
  if (message.mentionedIds?.length) return message.mentionedIds[0];
  if (message.hasQuotedMsg) {
    const quoted = await message.getQuotedMessage();
    return quoted.author || quoted.from;
  }
  return null;
}

async function isAdmin(chat, userId, contact = null) {
  const ids = new Set([
    userId,
    contact?.id?._serialized,
    contact?.number ? `${contact.number}@c.us` : '',
    contact?.number ? `${contact.number}@lid` : ''
  ].filter(Boolean));

  const participant = chat.participants?.find((item) => ids.has(item.id?._serialized));
  return Boolean(participant?.isAdmin || participant?.isSuperAdmin);
}

async function ensureAdmin(message, chat) {
  const contact = await message.getContact();
  const senderId = message.author || contact.id?._serialized || message.from;
  if (await hasBotAdminPermission(message, chat, contact, senderId)) return true;

  await message.reply('A ouvidoria informa: esse carimbo e so para admin.');
  return false;
}

async function ensureBotAdminPermission(message, chat) {
  const contact = await message.getContact();
  const senderId = message.author || contact.id?._serialized || message.from;
  if (await hasBotAdminPermission(message, chat, contact, senderId)) return true;

  await message.reply('A ouvidoria informa: esse carimbo e so para admin, adminbot, subdono ou dono.');
  return false;
}

async function ensureSubOwner(message, chat = null) {
  const contact = await message.getContact();
  const senderId = message.author || contact.id?._serialized || message.from;
  const level = await permissionLevel(message, chat, contact, senderId);
  if (level >= 3) return true;

  await message.reply('Essa gaveta e de subdono ou dono do Cleiton. Protocolo negado com delicadeza.');
  return false;
}

async function ensureOwner(message) {
  if (await isOwnerMessage(message)) return true;

  await message.reply('Esse painel de configuração é só do dono do Cleiton. Carimbo máximo negado.');
  return false;
}

async function isOwnerMessage(message) {
  const contact = await message.getContact();
  const ids = [
    message.author,
    message.from,
    contact?.id?._serialized,
    contact?.number ? `${contact.number}@c.us` : '',
    contact?.number ? `${contact.number}@lid` : ''
  ].filter(Boolean);

  const mappedIds = await getLidPhoneIds(ids);
  const allIds = [...ids, ...mappedIds];
  const owners = ownerNumbers();

  return allIds.some((id) => {
    const digits = onlyDigits(id);
    return owners.some((owner) => digits.includes(owner) || owner.includes(digits));
  });
}

async function hasBotAdminPermission(message, chat, contact = null, senderId = '') {
  return (await permissionLevel(message, chat, contact, senderId)) >= 1;
}

async function permissionLevel(message, chat = null, contact = null, senderId = '') {
  contact ||= await message.getContact();
  senderId ||= message.author || contact.id?._serialized || message.from;

  if (await isOwnerMessage(message)) return 4;

  const ids = await resolveIdentityIds(senderId, contact);
  const role = getRoleForIds(ids);
  if (role === 'subdono') return 3;
  if (role === 'adminbot') return 2;
  if (chat && await isAdmin(chat, senderId, contact)) return 1;
  return 0;
}

function getRoleForIds(ids) {
  for (const id of ids) {
    const role = getBotRole(id);
    if (role) return role;
  }
  return '';
}

async function resolveIdentityIds(userId = '', contact = null) {
  const base = [
    userId,
    contact?.id?._serialized,
    contact?.number ? `${contact.number}@c.us` : '',
    contact?.number ? `${contact.number}@lid` : ''
  ].filter(Boolean);
  const mapped = await getLidPhoneIds(base);
  return [...new Set([...base, ...mapped])];
}

async function isBlacklistedAny(ids) {
  for (const id of ids.filter(Boolean)) {
    if (isBlacklisted(id)) return true;
  }
  return false;
}

function ownerNumbers() {
  return parseCsv(getSetting('OWNER_NUMBERS', cleitonProfile.ownerNumber))
    .map(onlyDigits)
    .filter(Boolean);
}

function onlyDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

async function applyWarningPunishment(chat, targetId, count, reason) {
  const muteAt = numberSetting('WARN_MUTE_COUNT', 3);
  const kickAt = numberSetting('WARN_KICK_COUNT', 5);

  if (kickAt > 0 && count >= kickAt) {
    try {
      await chat.removeParticipants([targetId]);
      logEvent({ event: 'warn_auto_kick', chat, userId: targetId, message: reason });
    } catch (error) {
      logEvent({ level: 'error', event: 'warn_auto_kick_error', chat, userId: targetId, message: error?.message || String(error) });
    }
    return;
  }

  if (muteAt > 0 && count >= muteAt) {
    const minutes = numberSetting('AUTO_MUTE_MINUTES', 10);
    muteUser(chat.id._serialized, targetId, nowTs() + minutes * 60, `warn ${count}: ${reason}`);
    logEvent({ event: 'warn_auto_mute', chat, userId: targetId, message: `${minutes} min` });
  }
}

function removeMentionText(text = '') {
  return text.replace(/@\S+/g, '').trim();
}

function normalizeConfigKey(key = '') {
  const map = {
    antilink: 'ANTILINK_ENABLED',
    antispam: 'ANTISPAM_ENABLED',
    antiflood: 'ANTIFLOOD_MEDIA_ENABLED',
    palavroes: 'ANTIPALAVRAO_ENABLED',
    palavroeslista: 'PALAVRAS_BLOQUEADAS',
    whitelist: 'LINK_WHITELIST',
    regras30: 'AUTO_RULES_ENABLED',
    intervalo: 'AUTO_RULES_INTERVAL_MINUTES',
    maxtexto: 'MAX_TEXT_LENGTH',
    warnmute: 'WARN_MUTE_COUNT',
    warnkick: 'WARN_KICK_COUNT',
    backup: 'AUTO_BACKUP_ENABLED',
    backupintervalo: 'AUTO_BACKUP_INTERVAL_MINUTES',
    antiraid: 'ANTI_RAID_ENABLED',
    raidmax: 'ANTI_RAID_MAX_JOINS',
    raidjanela: 'ANTI_RAID_WINDOW_SECONDS',
    relatorio: 'DAILY_REPORT_ENABLED',
    relatoriohora: 'DAILY_REPORT_HOUR',
    manutencao: 'MAINTENANCE_MODE'
  };
  return map[key.toLowerCase()] || key.toUpperCase();
}

function normalizeConfigValue(value = '') {
  const lower = value.toLowerCase();
  if (['on', 'ligar', 'ligado', 'true', 'sim'].includes(lower)) return 'true';
  if (['off', 'desligar', 'desligado', 'false', 'nao', 'não'].includes(lower)) return 'false';
  return value;
}

async function safeDelete(message) {
  try {
    await message.delete(true);
  } catch {
    await message.reply('Cleiton tentou apagar, mas precisa de cargo de admin para passar o rodo.');
  }
}

async function safeReply(message, text) {
  try {
    await message.reply(text);
  } catch (error) {
    logEvent({ level: 'warn', event: 'reply_error', message: error?.message || String(error) });
  }
}

async function sendStatusCard(message, title, content, footer = cleitonProfile.packAuthor) {
  await safeReply(message, renderStatusCard(title, content, footer));
}

function renderStatusCard(title, content, footer = '') {
  const lines = [
    `*${title}*`,
    '━━━━━━━━━━━━━━'
  ];

  if (Array.isArray(content)) {
    for (const item of content) {
      if (Array.isArray(item)) {
        lines.push(`*${item[0]}:* ${item[1]}`);
      } else {
        lines.push(String(item));
      }
    }
  } else {
    lines.push(String(content));
  }

  if (footer) {
    lines.push('━━━━━━━━━━━━━━');
    lines.push(`_${footer}_`);
  }

  return lines.join('\n');
}

async function getNotificationMentions(notification) {
  if (!notification.recipientIds?.length) return [];
  const phoneByLid = new Map();
  for (const row of await getLidPhoneRows(notification.recipientIds)) {
    if (row.lid && row.pn) phoneByLid.set(row.lid, row.pn);
  }

  const targets = [];
  for (const id of notification.recipientIds) {
    const contact = await client.getContactById(id);
    const mappedPhone = phoneByLid.get(id);
    const mentionId = contact.number
      ? `${contact.number}@c.us`
      : mappedPhone || id;
    const mentionNumber = extractPhoneNumber(mentionId);
    const displayName = contact.pushname || contact.name || contact.shortName || 'novo membro';

    targets.push({
      id: contact.id?._serialized || mentionId || id,
      contact,
      ids: [id, contact.id?._serialized, mentionId, mappedPhone].filter(Boolean),
      mentionText: mentionNumber ? `@${mentionNumber}` : displayName
    });
  }

  return targets;
}

function shouldHandleChat(chat) {
  const allowedGroups = parseCsv(getSetting('GRUPOS_PERMITIDOS'));
  if (!allowedGroups.length) return true;
  const name = chat.name?.toLowerCase() || '';
  return allowedGroups.some((groupName) => name.includes(groupName.toLowerCase()));
}

function isSpam(chatId, userId) {
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  const windowMs = numberSetting('SPAM_WINDOW_SECONDS', 8) * 1000;
  const max = numberSetting('SPAM_MAX_MESSAGES', 6);
  const bucket = (spamBuckets.get(key) || []).filter((time) => now - time <= windowMs);
  bucket.push(now);
  spamBuckets.set(key, bucket);
  return bucket.length > max;
}

function cleitonMedia() {
  const imagePath = join(process.cwd(), 'public', 'assets', 'cleiton.jpeg');
  return existsSync(imagePath) ? MessageMedia.fromFilePath(imagePath) : null;
}

function cleitonPrompt() {
  return [
    'Você é Cleiton da Ouvidoria, uma barata atendente de grupo de WhatsApp.',
    'Sua personalidade é divertida, educada, ligeiramente burocrática e muito prestativa.',
    'Escreva sempre em português brasileiro correto, com acentuação, pontuação e concordância.',
    'Use humor curto de repartição pública e ouvidoria, mas sem prejudicar a clareza.',
    'Não seja ofensivo, não humilhe membros e não incentive brigas.',
    'Responda de forma breve, natural e útil, como um atendente atrás de um balcão de papelão.'
  ].join(' ');
}

function cleitonLine(type) {
  const lines = {
    boasVindas: 'Bem-vindo(a)! Pegue sua senha, limpe as antenas e leia o mural da ouvidoria.',
    antilink: 'Link sem autorização detectado. Cleiton subiu na mesa e protocolou a ocorrência.',
    spam: 'Excesso de entusiasmo no balcão. Cleiton aplicou uma pausa para respirar.',
    mute: 'Mute protocolado com sucesso.',
    kick: 'Remoção efetuada pela ouvidoria.',
    ban: 'Banimento administrativo registrado.',
    fechar: 'Porta do grupo abaixando igual repartição às 17h.',
    abrir: 'Porta aberta, protocolo liberado.'
  };
  return lines[type] || 'Protocolo concluído pelo Cleiton.';
}

function rulesText() {
  return normalizeMultiline(getSetting('REGRAS_GRUPO'));
}

function prefix() {
  return getSetting('COMMAND_PREFIX', '!');
}

function hasLink(text) {
  return /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|discord\.gg\/)/i.test(text);
}

function hasAllowedLink(text) {
  const whitelist = parseCsv(getSetting('LINK_WHITELIST'));
  if (!whitelist.length) return false;

  return whitelist.some((domain) => text.toLowerCase().includes(domain.toLowerCase()));
}

function hasBlockedWord(text) {
  const words = parseCsv(getSetting('PALAVRAS_BLOQUEADAS'));
  const lower = text.toLowerCase();
  return words.some((word) => word && lower.includes(word.toLowerCase()));
}

function isMediaFlood(chatId, userId) {
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  const windowMs = numberSetting('MEDIA_WINDOW_SECONDS', 20) * 1000;
  const max = numberSetting('MEDIA_MAX_MESSAGES', 4);
  const bucket = (mediaBuckets.get(key) || []).filter((time) => now - time <= windowMs);
  bucket.push(now);
  mediaBuckets.set(key, bucket);
  return bucket.length > max;
}

function isStickerMedia(mimetype = '') {
  return mimetype.startsWith('image/') || mimetype.startsWith('video/');
}

function extractPhoneNumber(id = '') {
  return id.endsWith('@c.us') ? id.split('@')[0] : '';
}

function formatWhatsAppId(id = '') {
  const [value, server] = id.split('@');
  if (!server) return id || 'indisponivel';
  return `${value} (${server})`;
}

function compactInternalId(...ids) {
  const id = ids.find(Boolean) || '';
  if (!id) return 'indisponivel';
  const [value, server] = id.split('@');
  const shortValue = value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
  return server ? `${shortValue} (${server})` : shortValue;
}

function formatMentionText(id = '') {
  const number = extractPhoneNumber(id);
  if (number) return `@${number}`;
  return compactInternalId(id);
}

async function displayNameForId(chat, id = '') {
  try {
    const mapped = await getLidPhoneIds([id]);
    const candidates = [...new Set([id, ...mapped].filter(Boolean))];
    const participant = chat?.participants?.find((item) => candidates.includes(item.id?._serialized));
    const contactId = participant?.id?._serialized || candidates.find((item) => item.endsWith('@c.us')) || candidates[0];
    const contact = contactId ? await getContactSafe(contactId) : null;
    const name = contact?.pushname || contact?.name || contact?.shortName;
    if (name) return name;
    return formatMentionText(contactId || id);
  } catch {
    return formatMentionText(id);
  }
}

function cleanX9Body(body = '') {
  const normalized = String(body).replace(/\s+/g, ' ').trim();
  if (!normalized) return '[midia ou mensagem sem texto]';
  const withoutPreview = normalized
    .replace(/https?:\/\/on\.soundcloud\.com\/\S+/gi, '')
    .replace(/https?:\/\/\S+/gi, (url) => url.length > 80 ? '[link]' : url)
    .trim();
  return withoutPreview || normalized;
}

function cleanupX9Seen() {
  const now = Date.now();
  for (const [id, time] of x9Seen) {
    if (now - time > 5 * 60 * 1000) x9Seen.delete(id);
  }
}

function cleanAiReply(text = '') {
  const cleaned = text
    .replace(/^>\s?/gm, '')
    .replace(/```/g, '')
    .replace(/\*\*/g, '*')
    .trim();

  return finishIncompleteReply(cleaned);
}

function finishIncompleteReply(text) {
  if (!text) return text;

  const normalized = text.trim();
  const looksComplete = /[.!?…)"']$/.test(normalized);
  if (looksComplete) return normalized;

  const brokenQuestion = /(qual|qual o|qual a|quem|como|quando|onde|por que|porque|para saber:?|me diga:?|informe:?)$/i;
  if (brokenQuestion.test(normalized)) {
    return normalized.replace(brokenQuestion, '').trimEnd() + '. Protocolo aberto; Cleiton vai precisar de mais detalhes para carimbar isso direito.';
  }

  return `${normalized}.`;
}

async function resolveMediaUrl(query) {
  if (/^https?:\/\//i.test(query)) return query;

  const result = await YouTube.searchOne(query, 'video');
  if (!result?.url) throw new Error(`Nenhum resultado encontrado para: ${query}`);
  return result.url;
}

async function getMediaInfo(url) {
  return ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noPlaylist: true,
    skipDownload: true
  }, { timeout: 45000 });
}

async function downloadMedia(url, kind) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const output = join(downloadDir, `${id}.%(ext)s`);
  const before = new Set(readdirSync(downloadDir));

  const flags = kind === 'audio'
    ? {
        format: 'bestaudio/best',
        output,
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 5,
        ffmpegLocation: ffmpegPath,
        noPlaylist: true,
        noWarnings: true,
        maxFilesize: `${numberSetting('PLAY_MAX_FILE_MB', 45)}M`
      }
    : {
        format: 'best[ext=mp4][height<=480]/best[height<=480][ext=mp4]/best[height<=480]/best',
        output,
        noPlaylist: true,
        noWarnings: true,
        maxFilesize: `${numberSetting('PLAY_MAX_FILE_MB', 45)}M`
      };

  await ytdlp.exec(url, flags, { timeout: 180000 });

  const created = readdirSync(downloadDir)
    .filter((file) => !before.has(file) && file.startsWith(id))
    .map((file) => join(downloadDir, file));

  if (!created.length) throw new Error('yt-dlp nao criou arquivo de midia');
  return created.sort((a, b) => statSync(b).size - statSync(a).size)[0];
}

function cleanupDownloads() {
  const now = Date.now();
  for (const file of readdirSync(downloadDir)) {
    const filePath = join(downloadDir, file);
    const ageMs = now - statSync(filePath).mtimeMs;
    if (ageMs > 60 * 60 * 1000) unlinkSafe(filePath);
  }
}

function unlinkSafe(filePath) {
  try {
    unlinkSync(filePath);
  } catch {
    // Best effort cleanup.
  }
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m${String(secs).padStart(2, '0')}s`;
}

function geminiModels() {
  const configured = process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  return configured
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
}

function isModelFallbackError(error) {
  const statusCode = error?.status || error?.code;
  return [403, 404, 429].includes(Number(statusCode));
}

function shouldAnswerByName(text) {
  return /\bcleiton\b/i.test(text);
}

async function isReplyToCleiton(message) {
  if (!message.hasQuotedMsg) return false;

  try {
    const quoted = await message.getQuotedMessage();
    return Boolean(quoted.fromMe);
  } catch {
    return false;
  }
}

function stripCleitonWakeWord(text) {
  return text
    .replace(/\bcleiton\b/ig, '')
    .replace(/^[\s,.:;!?-]+/, '')
    .trim();
}

function boolSetting(key) {
  return ['true', '1', 'sim', 'yes'].includes(getSetting(key, 'false').toLowerCase());
}

function numberSetting(key, fallback) {
  const value = Number(getSetting(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function parseDurationMinutes(text) {
  const match = text.match(/(\d+)\s*(m|min|h|hora|horas)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  return /h|hora/i.test(match[2] || '') ? value * 60 : value;
}

function parseCsv(value = '') {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeMultiline(value = '') {
  return value.replaceAll('\\n', '\n').trim();
}

function safeFileName(value = '') {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}
