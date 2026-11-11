// Registra (ou atualiza) os comandos de barra no Discord.
//
// Uso:
//   npm run register            → servidor de testes (atualiza na hora)
//   npm run register:global     → global (todos os servidores e DMs)
//   npm run register -- --dry-run   → só mostra o que seria enviado (sem rede, sem token)
//   npm run register -- --yes       → confirma a REMOÇÃO de comandos que saíram do código
//
// ⚠️ "Bulk overwrite": a lista enviada SUBSTITUI a lista atual no Discord.
// Por isso o script primeiro consulta o que já existe, mostra o plano
// (criar / atualizar / remover) e, se algo for ser removido, exige --yes.
// Docs: https://docs.discord.com/developers/interactions/application-commands

import { getCommandDefinitions } from '../src/commands/index.js';
import { retryDelayMs } from '../src/discord/followup.js';
import { SNOWFLAKE, validateDefinitions, planCommandChanges, hasChanges } from './lib/commandPlan.js';

const API_BASE = 'https://discord.com/api/v10';

const args = new Set(process.argv.slice(2));
const isGlobal = args.has('--global');
const isDryRun = args.has('--dry-run');
const confirmRemoval = args.has('--yes');

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

// 1) Valida os comandos e a configuração antes de qualquer chamada à rede.
const definitions = getCommandDefinitions();
const errors = validateDefinitions(definitions);
if (errors.length) fail(errors.join('\n  '));

const appId = process.env.DISCORD_APPLICATION_ID?.trim();
const token = process.env.DISCORD_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!appId || !SNOWFLAKE.test(appId)) fail('DISCORD_APPLICATION_ID ausente ou inválido no .dev.vars (esperado: número de 17 a 20 dígitos).');
if (!isGlobal && (!guildId || !SNOWFLAKE.test(guildId))) {
  fail('DISCORD_GUILD_ID ausente ou inválido no .dev.vars (ou use --global).');
}

const url = isGlobal
  ? `${API_BASE}/applications/${appId}/commands`
  : `${API_BASE}/applications/${appId}/guilds/${guildId}/commands`;
const scope = isGlobal ? 'GLOBAL' : `servidor ${guildId}`;

console.log(`Comandos no código (${definitions.length}) → destino: ${scope}`);
for (const def of definitions) {
  const lock = def.default_member_permissions === '0' ? ' 🔒' : '';
  console.log(`  /${def.name}${lock} — ${def.description}`);
}

if (isDryRun) {
  console.log('\n[dry-run] Nada foi enviado. Payload:');
  console.log(JSON.stringify(definitions, null, 2));
  process.exit(0);
}

if (!token) fail('DISCORD_TOKEN não definido no .dev.vars.');

/**
 * Faz uma chamada à API do Discord. Em caso de 429 (rate limit), respeita
 * `retry_after` e tenta UMA vez de novo. Em 401 para na hora: insistir com um
 * token inválido conta para o limite de requisições inválidas do Discord.
 */
async function discord(method, body) {
  const init = {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, // token nunca é impresso
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let response = await fetch(url, init);
  if (response.status === 429) {
    const wait = retryDelayMs(429, await response.json().catch(() => null));
    if (wait === null) fail('Rate limit do Discord (429) com espera longa. Tente novamente mais tarde.');
    console.log(`… rate limit: aguardando ${wait} ms`);
    await new Promise((r) => setTimeout(r, wait));
    response = await fetch(url, init);
  }
  if (response.ok) return response.json();

  if (response.status === 401) fail('Token inválido (401). Gere um novo em Bot > Reset Token e NÃO tente de novo com o mesmo.');
  if (response.status === 403) fail('Sem permissão (403). O app foi adicionado ao servidor com o escopo applications.commands?');
  if (response.status === 404) fail('Não encontrado (404). Confira DISCORD_APPLICATION_ID e DISCORD_GUILD_ID.');
  fail(`Discord respondeu ${response.status}: ${await response.text()}`);
}

// 2) Consulta o que já está registrado e monta o plano.
const current = await discord('GET');
const plan = planCommandChanges(current, definitions);

console.log('\nPlano:');
for (const name of plan.create) console.log(`  + criar      /${name}`);
for (const name of plan.update) console.log(`  ~ atualizar  /${name}`);
for (const name of plan.unchanged) console.log(`  = sem mudança /${name}`);
for (const name of plan.remove) console.log(`  - REMOVER    /${name}`);

if (!hasChanges(plan)) {
  console.log('\n✔ Nada a fazer: o Discord já está igual ao código.');
  process.exit(0);
}

if (plan.remove.length && !confirmRemoval) {
  fail(
    `${plan.remove.length} comando(s) serão REMOVIDOS do Discord porque não estão mais no código.\n` +
      '  Se é isso mesmo que você quer, rode de novo com --yes  (ex.: npm run register -- --yes)',
  );
}

// 3) Envia a lista completa (bulk overwrite).
const registered = await discord('PUT', definitions);
console.log(`\n✔ ${registered.length} comando(s) registrado(s) em ${scope}.`);
