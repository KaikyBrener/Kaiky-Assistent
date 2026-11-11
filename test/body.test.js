// Testes do limite real de tamanho do corpo (auditoria M1, B1).

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { readBodyWithLimit, BodyTooLargeError } from '../src/discord/readBody.js';
import { generateTestKeys, signBody, commandInteraction } from '../scripts/lib/signing.js';

const LIMIT = 64 * 1024;
let env;
let keys;

before(async () => {
  keys = await generateTestKeys();
  env = { DISCORD_PUBLIC_KEY: keys.publicKeyHex, OWNER_ID: '222222222222222222' };
});

/** Cria um corpo em stream (sem Content-Length) e conta quantos bytes foram lidos. */
function streamedBody(totalBytes, chunkSize = 16 * 1024) {
  const counter = { read: 0 };
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const size = Math.min(chunkSize, totalBytes - sent);
      sent += size;
      counter.read = sent;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
  return { stream, counter };
}

describe('Limite de 64 KB', () => {
  test('1 MB em stream SEM Content-Length → 413, e para de ler logo após o limite', async () => {
    const { stream, counter } = streamedBody(1024 * 1024);
    const request = new Request('http://localhost/', {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: { 'X-Signature-Ed25519': 'ab'.repeat(64), 'X-Signature-Timestamp': '1' },
    });
    assert.equal(request.headers.get('Content-Length'), null);
    const res = await worker.fetch(request, env, {});
    assert.equal(res.status, 413);
    // Antes da correção, o Worker lia 1.048.576 bytes. Agora para perto de 64 KB.
    assert.ok(counter.read <= LIMIT + 32 * 1024, `leu ${counter.read} bytes`);
  });

  test('Content-Length declarado acima do limite → 413 sem ler o corpo', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Length': String(LIMIT + 1) },
    });
    await assert.rejects(readBodyWithLimit(request, LIMIT), BodyTooLargeError);
  });

  test('corpo exatamente no limite é aceito; 1 byte a mais é recusado', async () => {
    const ok = await readBodyWithLimit(new Request('http://x/', { method: 'POST', body: new Uint8Array(LIMIT) }), LIMIT);
    assert.equal(ok.byteLength, LIMIT);
    await assert.rejects(
      readBodyWithLimit(new Request('http://x/', { method: 'POST', body: new Uint8Array(LIMIT + 1) }), LIMIT),
      BodyTooLargeError,
    );
  });

  test('requisição sem corpo vira 0 bytes (e falha na assinatura, não quebra)', async () => {
    const res = await worker.fetch(new Request('http://localhost/', { method: 'POST' }), env, {});
    assert.equal(res.status, 401);
  });

  test('interação legítima enviada em stream continua funcionando', async () => {
    const body = JSON.stringify(commandInteraction('ping'));
    const headers = await signBody(keys.privateKey, body);
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(bytes.subarray(0, 10));
        c.enqueue(bytes.subarray(10));
        c.close();
      },
    });
    const res = await worker.fetch(
      new Request('http://localhost/', { method: 'POST', body: stream, duplex: 'half', headers }),
      env,
      {},
    );
    assert.equal(res.status, 200);
    assert.match((await res.json()).data.content, /Pong!/);
  });

  test('assinatura é feita sobre os bytes: caracteres acentuados funcionam', async () => {
    const body = JSON.stringify({ ...commandInteraction('ping'), extra: 'ação é ótimo 🚀' });
    const headers = await signBody(keys.privateKey, body);
    const res = await worker.fetch(new Request('http://localhost/', { method: 'POST', body, headers }), env, {});
    assert.equal(res.status, 200);
  });
});
