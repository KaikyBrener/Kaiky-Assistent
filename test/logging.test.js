// Testes de logs estruturados e tratamento de erros (auditoria M6, B3).

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { buildLogEntry, errorFields } from '../src/services/logger.js';
import { runCommand } from '../src/events/interactionHandler.js';
import { generateTestKeys, signBody, commandInteraction } from '../scripts/lib/signing.js';

const OWNER = '222222222222222222';
let keys;
let env;
let lines;
const originals = {};

before(async () => {
  keys = await generateTestKeys();
  env = { DISCORD_PUBLIC_KEY: keys.publicKeyHex, OWNER_ID: OWNER };
});

// Captura tudo o que seria escrito no console durante cada teste.
beforeEach(() => {
  lines = [];
  for (const level of ['log', 'warn', 'error']) {
    originals[level] = console[level];
    console[level] = (line) => lines.push({ level, line });
  }
});
afterEach(() => {
  for (const level of ['log', 'warn', 'error']) console[level] = originals[level];
});

const parsed = () => lines.map(({ line }) => JSON.parse(line));

async function signedPost(payload) {
  const body = JSON.stringify(payload);
  const headers = await signBody(keys.privateKey, body);
  return worker.fetch(new Request('http://localhost/', { method: 'POST', body, headers }), env, {});
}

describe('Logger', () => {
  test('descarta o token da interação e campos fora da lista permitida', () => {
    const interaction = commandInteraction('ping');
    const entry = buildLogEntry('info', 'x', { ...interaction, interaction_id: interaction.id, senha: '123' });
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes(interaction.token), false);
    assert.equal('token' in entry, false);
    assert.equal('senha' in entry, false);
    assert.equal('member' in entry, false);
    assert.equal(entry.interaction_id, interaction.id);
  });

  test('corta textos longos', () => {
    assert.equal(buildLogEntry('info', 'x', { reason: 'a'.repeat(5000) }).reason.length, 1000);
  });

  test('errorFields extrai nome, mensagem e stack', () => {
    const fields = errorFields(new TypeError('falhou'));
    assert.equal(fields.error_name, 'TypeError');
    assert.equal(fields.error_message, 'falhou');
    assert.match(fields.stack, /TypeError/);
  });
});

describe('Logs por requisição', () => {
  test('/ping gera exatamente um log JSON de resumo, sem token', async () => {
    const interaction = commandInteraction('ping');
    await signedPost(interaction);
    const entries = parsed();
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
      level: 'info',
      event: 'interaction',
      interaction_id: interaction.id,
      interaction_type: 2,
      command: 'ping',
      outcome: 'ok',
      http_status: 200,
    });
    assert.equal(lines[0].line.includes(interaction.token), false);
  });

  test('assinatura inválida gera log de aviso com o motivo', async () => {
    await worker.fetch(new Request('http://localhost/', { method: 'POST', body: '{}' }), env, {});
    assert.deepEqual(parsed(), [
      { level: 'warn', event: 'request_rejected', reason: 'invalid_signature', http_status: 401 },
    ]);
  });

  test('comando negado registra o motivo owner_not_configured quando falta OWNER_ID', async () => {
    const meta = {};
    const cmd = { data: { name: 'privado', description: 'x' }, execute: async () => new Response('x') };
    await runCommand(cmd, commandInteraction('privado'), { config: { ownerId: null }, meta });
    assert.deepEqual(meta, { outcome: 'denied', reason: 'owner_not_configured' });
  });
});

describe('Tratamento de erros', () => {
  test('comando que devolve string (não Response) vira mensagem amigável + log de erro', async () => {
    const meta = {};
    const cmd = { data: { name: 'errado', description: 'x' }, ownerOnly: false, execute: async () => 'texto' };
    const res = await runCommand(cmd, commandInteraction('errado'), { config: { ownerId: OWNER }, meta });
    assert.match((await res.json()).data.content, /Ocorreu um erro/);
    assert.equal(meta.outcome, 'error');
    const [entry] = parsed();
    assert.equal(entry.event, 'command_failed');
    assert.equal(entry.error_name, 'TypeError');
  });

  test('falha inesperada ao ler o corpo → 500 limpo e log unhandled_error', async () => {
    const broken = new ReadableStream({
      pull() {
        throw new Error('conexão caiu');
      },
    });
    const res = await worker.fetch(
      new Request('http://localhost/', { method: 'POST', body: broken, duplex: 'half' }),
      env,
      {},
    );
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Erro interno.' });
    const [entry] = parsed();
    assert.equal(entry.event, 'unhandled_error');
    assert.equal(entry.level, 'error');
  });
});
