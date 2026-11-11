// Registra (ou atualiza) os comandos de barra no Discord.
//
// Uso:
//   npm run register           → registra no seu servidor de testes (atualiza na hora)
//   npm run register:global    → registra globalmente (todos os servidores/DMs)
//   node --env-file=.dev.vars scripts/register-commands.js --dry-run
//                               → só mostra o que seria enviado, sem chamar a API
//
// Usa o endpoint de "bulk overwrite": a lista enviada SUBSTITUI a lista atual.
// Comando que não estiver em src/commands/index.js será removido do Discord.
// Docs: https://docs.discord.com/developers/interactions/application-commands

import { getCommandDefinitions } from '../src/commands/index.js';

const API_BASE = 'https://discord.com/api/v10';
const NAME_RULE = /^[-_ʼ\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

const args = new Set(process.argv.slice(2));
const isGlobal = args.has('--global');
const isDryRun = args.has('--dry-run');

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function validateDefinitions(definitions) {
  for (const def of definitions) {
    if (!NAME_RULE.test(def.name) || def.name !== def.name.toLowerCase()) {
      fail(`Nome inválido: "${def.name}" (use minúsculas, 1 a 32 caracteres).`);
    }
    if (!def.description || def.description.length > 100) {
      fail(`Descrição de /${def.name} precisa ter de 1 a 100 caracteres.`);
    }
  }
}

const definitions = getCommandDefinitions();
validateDefinitions(definitions);

const appId = process.env.DISCORD_APPLICATION_ID?.trim();
const token = process.env.DISCORD_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!appId) fail('DISCORD_APPLICATION_ID não definido no .dev.vars.');
if (!isGlobal && !guildId) fail('DISCORD_GUILD_ID não definido (ou use --global).');

const url = isGlobal
  ? `${API_BASE}/applications/${appId}/commands`
  : `${API_BASE}/applications/${appId}/guilds/${guildId}/commands`;

const scope = isGlobal ? 'global' : `servidor ${guildId}`;
console.log(`Comandos (${definitions.length}) → ${scope}:`);
for (const def of definitions) console.log(`  /${def.name} — ${def.description}`);

if (isDryRun) {
  console.log('\n[dry-run] Nada foi enviado. Payload:');
  console.log(JSON.stringify(definitions, null, 2));
  process.exit(0);
}

if (!token) fail('DISCORD_TOKEN não definido no .dev.vars.');

const response = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${token}`, // o token nunca é impresso no terminal
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(definitions),
});

if (!response.ok) {
  const detail = await response.text();
  if (response.status === 401) fail('Token inválido (401). Gere um novo em Bot > Reset Token.');
  if (response.status === 403) fail('Sem permissão (403). O bot foi adicionado ao servidor com o escopo applications.commands?');
  fail(`Discord respondeu ${response.status}: ${detail}`);
}

const registered = await response.json();
console.log(`\n✔ ${registered.length} comando(s) registrado(s) com sucesso.`);
