const keys = [
  'COMMAND_PREFIX',
  'GRUPOS_PERMITIDOS',
  'ANTILINK_ENABLED',
  'ANTISPAM_ENABLED',
  'SPAM_MAX_MESSAGES',
  'SPAM_WINDOW_SECONDS',
  'AUTO_MUTE_MINUTES',
  'REGRAS_GRUPO',
  'BOT_PROMPT'
];

async function load() {
  const [status, settings, groups, logs] = await Promise.all([
    fetch('/api/status').then((res) => res.json()),
    fetch('/api/settings').then((res) => res.json()),
    fetch('/api/groups').then((res) => res.json()),
    fetch('/api/logs').then((res) => res.json())
  ]);

  document.querySelector('#status').textContent = status.ready ? 'online' : 'aguardando QR';
  document.querySelector('#groupsCount').textContent = status.groups;
  document.querySelector('#lastEvent').textContent = status.lastEvent;

  const map = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  for (const key of keys) {
    const el = document.querySelector(`#${key}`);
    if (el) el.value = (map[key] || '').replaceAll('\\n', '\n');
  }

  document.querySelector('#groups').innerHTML = groups.map((group) => `
    <div class="item">
      <strong>${escapeHtml(group.name)}</strong>
      <span>${group.participants} participantes | ${escapeHtml(group.chat_id)}</span>
    </div>
  `).join('') || '<div class="item">Nenhum grupo visto ainda.</div>';

  document.querySelector('#logs').innerHTML = logs.map((log) => `
    <div class="item">
      <strong>${escapeHtml(log.event)} | ${escapeHtml(log.level)}</strong>
      <span>${escapeHtml(log.created_at)} | ${escapeHtml(log.chat_name || 'sem grupo')} | ${escapeHtml(log.message || '')}</span>
    </div>
  `).join('') || '<div class="item">Sem ocorrencias no balcao.</div>';
}

document.querySelector('#save').addEventListener('click', async () => {
  for (const key of keys) {
    const el = document.querySelector(`#${key}`);
    await fetch(`/api/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: el.value.replaceAll('\n', '\\n') })
    });
  }
  await load();
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

load();
setInterval(load, 5000);
