export const cleitonProfile = {
  botName: 'Cleiton',
  shortName: 'Cleiton',
  ownerNumber: '5522981347316',
  ownerLabel: '+55 22 98134-7316',
  character: 'barata irreverente',
  packName: 'Cleiton',
  packAuthor: 'Cleiton'
};

export function cleitonDefaultSettings(env = process.env) {
  return {
    COMMAND_PREFIX: env.COMMAND_PREFIX || '!',
    OWNER_NUMBERS: env.OWNER_NUMBERS || cleitonProfile.ownerNumber,
    GRUPOS_PERMITIDOS: env.GRUPOS_PERMITIDOS || '',
    REGRAS_GRUPO: env.REGRAS_GRUPO || [
      '1. Respeite todos os membros.',
      '2. Evite spam e correntes.',
      '3. Nada de conteudo ofensivo.',
      '4. Fale com a administracao em caso de duvida.'
    ].join('\n'),
    ANTILINK_ENABLED: env.ANTILINK_ENABLED || 'true',
    ANTISPAM_ENABLED: env.ANTISPAM_ENABLED || 'true',
    ANTIFLOOD_MEDIA_ENABLED: env.ANTIFLOOD_MEDIA_ENABLED || 'true',
    ANTIPALAVRAO_ENABLED: env.ANTIPALAVRAO_ENABLED || 'false',
    LINK_WHITELIST: env.LINK_WHITELIST || 'youtube.com,youtu.be,instagram.com,tiktok.com',
    PALAVRAS_BLOQUEADAS: env.PALAVRAS_BLOQUEADAS || '',
    SPAM_MAX_MESSAGES: env.SPAM_MAX_MESSAGES || '6',
    SPAM_WINDOW_SECONDS: env.SPAM_WINDOW_SECONDS || '8',
    MEDIA_MAX_MESSAGES: env.MEDIA_MAX_MESSAGES || '4',
    MEDIA_WINDOW_SECONDS: env.MEDIA_WINDOW_SECONDS || '20',
    MAX_TEXT_LENGTH: env.MAX_TEXT_LENGTH || '1200',
    WARN_MUTE_COUNT: env.WARN_MUTE_COUNT || '3',
    WARN_KICK_COUNT: env.WARN_KICK_COUNT || '5',
    AUTO_MUTE_MINUTES: env.AUTO_MUTE_MINUTES || '10',
    PLAY_MAX_DURATION_SECONDS: env.PLAY_MAX_DURATION_SECONDS || '600',
    PLAY_MAX_FILE_MB: env.PLAY_MAX_FILE_MB || '45',
    AUTO_RULES_ENABLED: env.AUTO_RULES_ENABLED || 'false',
    AUTO_RULES_INTERVAL_MINUTES: env.AUTO_RULES_INTERVAL_MINUTES || '30',
    AUTO_BACKUP_ENABLED: env.AUTO_BACKUP_ENABLED || 'true',
    AUTO_BACKUP_INTERVAL_MINUTES: env.AUTO_BACKUP_INTERVAL_MINUTES || '360',
    ANTI_RAID_ENABLED: env.ANTI_RAID_ENABLED || 'true',
    ANTI_RAID_MAX_JOINS: env.ANTI_RAID_MAX_JOINS || '5',
    ANTI_RAID_WINDOW_SECONDS: env.ANTI_RAID_WINDOW_SECONDS || '60',
    X9_ENABLED: env.X9_ENABLED || 'false',
    DAILY_REPORT_ENABLED: env.DAILY_REPORT_ENABLED || 'true',
    DAILY_REPORT_HOUR: env.DAILY_REPORT_HOUR || '9',
    MAINTENANCE_MODE: env.MAINTENANCE_MODE || 'false',
    BOT_DISPLAY_NAME: env.BOT_DISPLAY_NAME || cleitonProfile.botName,
    MENU_TOP_BORDER: env.MENU_TOP_BORDER || '╭┈',
    MENU_BOTTOM_BORDER: env.MENU_BOTTOM_BORDER || '╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯',
    MENU_MIDDLE_BORDER: env.MENU_MIDDLE_BORDER || '┊',
    MENU_ITEM_ICON: env.MENU_ITEM_ICON || '• ',
    MENU_SEPARATOR_ICON: env.MENU_SEPARATOR_ICON || '📎',
    MENU_HEADER: env.MENU_HEADER || `╭┈⊰ 🪳 『 *{botName}* 』\n┊Olá, {userName}!\n╰─┈┈┈┈┈◜📎◞┈┈┈┈┈─╯`,
    MENU_READ_MORE_ENABLED: env.MENU_READ_MORE_ENABLED || 'false'
  };
}
