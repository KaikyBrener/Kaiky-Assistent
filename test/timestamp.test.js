// Testes da validação temporal do timestamp (auditoria M2).

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { isTimestampFresh, MAX_TIMESTAMP_SKEW_SECONDS } from '../src/discord/verifySignature.js';
import { generateTestKeys, signBody, commandInteraction } from '../scripts/lib/signing.js';

let keys;
let env;
const nowSeconds = () => Math.floor(Date.now() / 1000);

before(async () => {
  keys = await generateTestKeys();
  env = { DISCORD_PUBLIC_KEY: keys.publicKeyHex, OWNER_ID: '222222222222222222' };
});

async function sendWithTimestamp(timestamp) {
  const body = JSON.stringify(commandInteraction('ping'));
  // A assinatura é VÁLIDA: só o horário é que está fora da janela.
  const headers = await signBody(keys.privateKey, body, String(timestamp));
  return worker.fetch(new Request('http://localhost/', { method: 'POST', body, headers }), env, {});
}

describe('Timestamp', () => {
  test('timestamp atual → aceito', async () => {
    assert.equal((await sendWithTimestamp(nowSeconds())).status, 200);
  });

  test('assinatura válida de 2 anos atrás → 401 (antes da correção era 200)', async () => {
    assert.equal((await sendWithTimestamp(nowSeconds() - 2 * 365 * 86400)).status, 401);
  });

  test('assinatura válida de 10 minutos no futuro → 401', async () => {
    assert.equal((await sendWithTimestamp(nowSeconds() + 600)).status, 401);
  });

  test('limites da janela de 5 minutos', () => {
    const now = 1_800_000_000_000; // relógio fixo
    const t = (s) => String(now / 1000 + s);
    assert.equal(isTimestampFresh(t(-MAX_TIMESTAMP_SKEW_SECONDS), now), true);
    assert.equal(isTimestampFresh(t(-MAX_TIMESTAMP_SKEW_SECONDS - 1), now), false);
    assert.equal(isTimestampFresh(t(MAX_TIMESTAMP_SKEW_SECONDS), now), true);
    assert.equal(isTimestampFresh(t(MAX_TIMESTAMP_SKEW_SECONDS + 1), now), false);
  });

  test('formatos inválidos são recusados', () => {
    for (const bad of ['', 'abc', '-1', '1.5', '1e9', ' 1700000000', '9'.repeat(13), null, undefined]) {
      assert.equal(isTimestampFresh(bad), false, `aceitou ${JSON.stringify(bad)}`);
    }
  });
});
