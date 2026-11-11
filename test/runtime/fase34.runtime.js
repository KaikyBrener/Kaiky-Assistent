// Integração das FASES 3 e 4 no runtime real (workerd) com D1 local.
// O Cron é disparado com server.getWorker().scheduled(...). Nenhuma mensagem
// real é enviada: os cenários não têm nada a notificar ou usam webhook inválido.

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';

import { generateTestKeys, signBody, commandInteraction, snowflakeNow } from '../../scripts/lib/signing.js';
import { fromLocal } from '../../src/services/dateTime.js';

const OWNER = '222222222222222222';
const STRANGER = '111111111111111111';
const keys = await generateTestKeys();
const SECRETS = {
  DISCORD_PUBLIC_KEY: keys.publicKeyHex,
  OWNER_ID: OWNER,
  DISCORD_WEBHOOK_URL: `https://discord.com/api/webhooks/123456789012345678/${'a'.repeat(68)}`,
  GITHUB_TOKEN: 'token-falso-nao-e-real-0000000000',
};

const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc', secrets: SECRETS }] });

before(async () => {
  await server.listen();
});
beforeEach(async () => {
  await server.getWorker().applyD1Migrations('DB');
  server.clearLogs();
});
afterEach(async () => {
  await server.reset();
});
after(async () => {
  await server.close();
});

let seq = 0;
function interacao(name, sub, values = {}, userId = OWNER) {
  const base = commandInteraction(name, userId);
  const id = `${snowflakeNow()}${String(++seq).padStart(3, '0')}`;
  if (!sub) return { ...base, id };
  const options = Object.entries(values).map(([n, value]) => ({ name: n, value, type: typeof value === 'number' ? 4 : 3 }));
  return { ...base, id, data: { ...base.data, options: [{ name: sub, type: 1, options }] } };
}

async function send(payload) {
  const body = JSON.stringify(payload);
  const res = await server.fetch('/', { method: 'POST', body, headers: await signBody(keys.privateKey, body) });
  return res.json();
}

async function waitForLog(fragment, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = server.getLogs().find((l) => l.message.includes(fragment));
    if (found) return found.message;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe('FASE 3 no workerd', () => {
  test('o Cron (scheduled) roda: madrugada sem tarefas não envia nada', async () => {
    const result = await server.getWorker().scheduled({
      cron: '*/5 * * * *',
      scheduledTime: new Date(fromLocal(2026, 11, 19, 3, 0)),
    });
    assert.equal(result.outcome, 'ok');
    const log = await waitForLog('"event":"scheduled"');
    assert.match(log, /lembretes=nada_a_enviar relatorio=antes_do_horario/);
  });

  test('wrangler.jsonc declara o Cron de 5 em 5 minutos', async () => {
    const { readFile } = await import('node:fs/promises');
    assert.match(await readFile('wrangler.jsonc', 'utf8'), /"crons": \["\*\/5 \* \* \* \*"\]/);
  });

  test('/tarefa criar com prazo mostra o vencimento; /tarefa listar exibe 📅', async () => {
    const criada = await send(interacao('tarefa', 'criar', { titulo: 'Prova de BD', prazo: '15/12/2030 19:00' }));
    assert.match(criada.data.content, /📅 15\/12 19:00/);
    assert.match(criada.data.content, /Vence em 15\/12\/2030 19:00 \(horário de Brasília\)/);
    const lista = await send(interacao('tarefa', 'listar'));
    assert.match(lista.data.content, /Prova de BD · 📅 15\/12 19:00/);
  });

  test('prazo inválido ou no passado é recusado', async () => {
    assert.match((await send(interacao('tarefa', 'criar', { titulo: 'x', prazo: '31/02/2030' }))).data.content, /Prazo inválido/);
    assert.match((await send(interacao('tarefa', 'criar', { titulo: 'x', prazo: '01/01/2020 10:00' }))).data.content, /já passou/);
  });

  test('a tabela notificacoes existe depois das migrations', async () => {
    const env = await server.getWorker().getEnv();
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notificacoes'").first();
    assert.equal(row?.name, 'notificacoes');
  });
});

describe('FASE 4 no workerd', () => {
  test('/painel: só o proprietário, resposta efêmera', async () => {
    const dono = await send(interacao('painel'));
    assert.match(dono.data.content, /Painel do Kaiky Assistant/);
    assert.equal(dono.data.flags, 64);
    const estranho = await send(interacao('painel', null, {}, STRANGER));
    assert.match(estranho.data.content, /restrito ao proprietário/);
  });

  test('/ajuda: pública e lista os comandos', async () => {
    const res = await send(interacao('ajuda', null, {}, STRANGER));
    assert.match(res.data.content, /`\/tarefa` 🔒/);
    assert.match(res.data.content, /`\/github` 🔒/);
  });

  test('/github: responde na hora com "pensando..." (type 5, efêmero)', async () => {
    const res = await send(interacao('github', 'repos'));
    assert.deepEqual(res, { type: 5, data: { flags: 64 } });
  });

  test('/github: estranho é bloqueado ANTES de adiar (nada é consultado)', async () => {
    const res = await send(interacao('github', 'repos', {}, STRANGER));
    assert.equal(res.type, 4);
    assert.match(res.data.content, /restrito ao proprietário/);
  });
});
