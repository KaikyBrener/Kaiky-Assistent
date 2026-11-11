// Testes das respostas adiadas (auditoria M5).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { runCommand } from '../src/events/interactionHandler.js';
import { editOriginalResponse, retryDelayMs } from '../src/discord/followup.js';
import { commandInteraction } from '../scripts/lib/signing.js';

const OWNER = '222222222222222222';
const APP_ID = '123456789012345678';
const config = { ownerId: OWNER, appName: 'Teste' };

let calls;
let logs;
let originalFetch;
let originalError;

beforeEach(() => {
  calls = [];
  logs = [];
  originalFetch = globalThis.fetch;
  originalError = console.error;
  console.error = (line) => logs.push(line);
  // Simula o Discord: registra a chamada e responde 200.
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
});

/** ctx falso: guarda as promessas passadas para waitUntil, como o Workers faria. */
function fakeCtx() {
  const pending = [];
  return { pending, waitUntil: (promise) => pending.push(promise) };
}

function interaction(name = 'demorado') {
  return { ...commandInteraction(name, OWNER), application_id: APP_ID, token: 'tok.en-SECRETO_123' };
}

const slowCommand = (execute, extra = {}) => ({
  data: { name: 'demorado', description: 'x' },
  deferred: true,
  execute,
  ...extra,
});

describe('Comandos adiados', () => {
  test('responde na hora com type 5 e depois edita @original com o resultado', async () => {
    const ctx = fakeCtx();
    const meta = {};
    const res = await runCommand(slowCommand(async () => 'pronto!'), interaction(), { config, ctx, meta });

    assert.deepEqual(await res.json(), { type: 5 });
    assert.equal(meta.deferred, true);
    assert.equal(ctx.pending.length, 1, 'o trabalho foi entregue ao waitUntil');

    await Promise.all(ctx.pending);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://discord.com/api/v10/webhooks/${APP_ID}/tok.en-SECRETO_123/messages/@original`);
    assert.equal(calls[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].init.body), { content: 'pronto!', allowed_mentions: { parse: [] } });
  });

  test('ephemeral: true envia o flag 64 já na resposta adiada', async () => {
    const res = await runCommand(slowCommand(async () => 'x', { ephemeral: true }), interaction(), {
      config,
      ctx: fakeCtx(),
    });
    assert.deepEqual(await res.json(), { type: 5, data: { flags: 64 } });
  });

  test('erro no comando adiado → mensagem genérica no Discord e log sem token', async () => {
    const ctx = fakeCtx();
    await runCommand(slowCommand(async () => { throw new Error('falha interna'); }), interaction(), { config, ctx });
    await Promise.all(ctx.pending);
    const sent = JSON.parse(calls[0].init.body).content;
    assert.match(sent, /Ocorreu um erro/);
    assert.doesNotMatch(sent, /falha interna/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].includes('SECRETO'), false);
  });

  test('Discord recusa a edição → log followup_failed com status, sem token nem URL', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    const ctx = fakeCtx();
    await runCommand(slowCommand(async () => 'ok'), interaction(), { config, ctx });
    await Promise.all(ctx.pending);
    const entry = JSON.parse(logs[0]);
    assert.equal(entry.event, 'followup_failed');
    assert.equal(entry.http_status, 404);
    assert.equal(logs[0].includes('SECRETO'), false);
    assert.equal(logs[0].includes('webhooks'), false);
  });

  test('a permissão é checada ANTES de adiar', async () => {
    const ctx = fakeCtx();
    const stranger = { ...interaction(), member: { user: { id: '111111111111111111' } } };
    const res = await runCommand(slowCommand(async () => 'segredo'), stranger, { config, ctx });
    assert.match((await res.json()).data.content, /restrito/);
    assert.equal(ctx.pending.length, 0);
  });
});

describe('editOriginalResponse', () => {
  test('recusa application_id ou token em formato inesperado (sem chamar a rede)', async () => {
    assert.deepEqual(await editOriginalResponse('../x', 'tok', {}), { ok: false, status: 0 });
    assert.deepEqual(await editOriginalResponse(APP_ID, 'tok/../../x', {}), { ok: false, status: 0 });
    assert.equal(calls.length, 0);
  });

  test('429 com retry_after curto → espera e tenta UMA vez de novo', async () => {
    let n = 0;
    const fetchImpl = async () =>
      ++n === 1
        ? new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 })
        : new Response('{}', { status: 200 });
    assert.deepEqual(await editOriginalResponse(APP_ID, 'tok', {}, { fetchImpl }), { ok: true, status: 200 });
    assert.equal(n, 2);
  });

  test('404 (resposta "pensando..." ainda não registrada) → espera e tenta UMA vez de novo', async () => {
    let n = 0;
    const fetchImpl = async () => new Response('{}', { status: ++n === 1 ? 404 : 200 });
    assert.deepEqual(await editOriginalResponse(APP_ID, 'tok', {}, { fetchImpl }), { ok: true, status: 200 });
    assert.equal(n, 2);
  });

  test('retryDelayMs: 404 → 1 s; 429 só com espera de até 5 s; resto não repete', () => {
    assert.equal(retryDelayMs(404, null), 1000);
    assert.equal(retryDelayMs(429, { retry_after: 1.5 }), 1500);
    assert.equal(retryDelayMs(429, { retry_after: 60 }), null);
    assert.equal(retryDelayMs(429, {}), null);
    assert.equal(retryDelayMs(500, { retry_after: 1 }), null);
    assert.equal(retryDelayMs(401, null), null);
  });
});
