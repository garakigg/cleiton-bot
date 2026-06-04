const categories = {
  menu: {
    title: 'MENU PRINCIPAL',
    aliases: ['menu', 'help', 'ajuda', 'comandos', 'commands', 'menulist'],
    commands: ['menuia', 'menudown', 'menufig', 'menuadm', 'menudono', 'menumemb', 'menubrin', 'ferramentas']
  },
  menuia: {
    title: 'MENU IA',
    aliases: ['menuia', 'aimenu', 'menuias'],
    commands: ['cleiton', 'cleitonoff', 'cleitonon', 'imagem', 'resumir', 'corrigir', 'traduzir']
  },
  menudown: {
    title: 'MENU DOWNLOADS',
    aliases: ['menudown', 'menudownload', 'menudownloads', 'downmenu', 'downloadmenu'],
    commands: ['play', 'musica', 'video', 'playvid', 'tkk', 'tiktok']
  },
  menufig: {
    title: 'MENU FIGURINHAS',
    aliases: ['menufig', 'menufigurinhas', 'stickermenu'],
    commands: ['sticker', 'figurinha', 'ttp', 'attp']
  },
  menuadm: {
    title: 'MENU ADMIN',
    aliases: ['menuadm', 'menuadmin', 'menuadmins', 'admmenu'],
    commands: ['ban', 'kick', 'mute', 'desmute', 'warn', 'adv', 'rmadv', 'listadv', 'del', 'limpar', 'todos', 'marcar', 'hidetag', 'x9', 'antitrava', 'antiflood', 'antilinkgp', 'antlink', 'whitelistlink', 'antipalavra', 'fechargp', 'abrirgp', 'opengp', 'closegp', 'promover', 'rebaixar']
  },
  menudono: {
    title: 'MENU DONO',
    aliases: ['menudono', 'ownermenu', 'menuowner'],
    commands: ['config', 'relatorio', 'anticall', 'pmblocker', 'autoread', 'autotyping', 'antidelete', 'cleartmp']
  },
  menumemb: {
    title: 'MENU MEMBROS',
    aliases: ['menumembros', 'menumemb', 'menugeral', 'membmenu', 'membermenu'],
    commands: ['perfil', 'perfilcard', 'meustatus', 'ping', 'status', 'statusbot', 'regras', 'rank', 'rankativo', 'ranksemanal', 'rankmensal', 'rankgrafico', 'topfigurinhas', 'topmidias', 'dono', 'criador']
  },
  ferramentas: {
    title: 'MENU FERRAMENTAS',
    aliases: ['ferramentas', 'menuferramentas', 'menuferramenta', 'toolsmenu', 'tools'],
    commands: ['qr', 'removebg', 'voz', 'lembrete', 'enquete', 'sorteio', 'legendaimg', 'aviso']
  },
  menubrin: {
    title: 'MENU BRINCADEIRAS',
    aliases: ['menubrin', 'menubrincadeiras', 'brincadeiras', 'funmenu', 'menufun'],
    commands: ['casal', 'quiz', 'dueloquiz', 'roletarussa', 'tapa', 'wanted', 'preso', 'wasted', 'responder']
  }
};

export function getMenuCategory(command = '') {
  const normalized = command.toLowerCase();
  return Object.entries(categories).find(([, category]) => category.aliases.includes(normalized))?.[0] || '';
}

export function getCategory(key = '') {
  return categories[key] || null;
}

export function getCommandCategory(command = '') {
  const normalized = command.toLowerCase();
  return Object.entries(categories).find(([, category]) => category.commands.includes(normalized) || category.aliases.includes(normalized))?.[0] || '';
}

export function allCatalogCommands() {
  return [...new Set(Object.values(categories).flatMap((category) => [...category.aliases, ...category.commands]))];
}

export function allMenuCategories() {
  return Object.entries(categories).map(([key, category]) => ({ key, ...category }));
}
