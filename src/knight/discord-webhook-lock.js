import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const configPath = join(process.cwd(), 'config', 'cleiton-config.json');
const checkIntervalMs = 15000;

function loadDiscordConfig() {
  const envConfig = {
    enabled: true,
    logsWebhookUrl: process.env.DISCORD_LOGS_WEBHOOK_URL || '',
    messagesWebhookUrl: process.env.DISCORD_MESSAGES_WEBHOOK_URL || ''
  };

  if (!existsSync(configPath)) return envConfig;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return {
      ...envConfig,
      ...(config.discord || {})
    };
  } catch {
    return envConfig;
  }
}

function isDiscordWebhookUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    const validHost = url.hostname === 'discord.com' || url.hostname === 'discordapp.com';
    return validHost && /^\/api\/webhooks\/\d+\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}

function stopBot(reason) {
  console.error(`Trava Discord acionada: ${reason}`);
  process.exit(1);
}

function enforceDiscordWebhooks() {
  const discord = loadDiscordConfig();
  if (discord.enabled !== true) stopBot('discord.enabled precisa ficar true');
  if (!isDiscordWebhookUrl(discord.logsWebhookUrl)) stopBot('discord.logsWebhookUrl ausente ou invalida');
  if (!isDiscordWebhookUrl(discord.messagesWebhookUrl)) stopBot('discord.messagesWebhookUrl ausente ou invalida');
}

enforceDiscordWebhooks();
setInterval(enforceDiscordWebhooks, checkIntervalMs).unref();

const originalFetch = globalThis.fetch;
if (typeof originalFetch === 'function') {
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const target = String(args[0]?.url || args[0] || '');
    if (/https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\//i.test(target) && [401, 403, 404].includes(response.status)) {
      stopBot(`webhook recusada pelo Discord com HTTP ${response.status}`);
    }
    return response;
  };
}
