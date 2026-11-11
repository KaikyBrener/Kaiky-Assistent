// Testes automatizados com o executor nativo do Node (node:test).
// Rodam o MESMO código do Worker chamando `worker.fetch()` diretamente,
// com requisições assinadas por uma chave de teste.
//
// Uso: npm test

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { hexToBytes } from '../src/discord/verifySignature.js';
import { runCommand } from '../src/events/interactionHandler.js';
import { isOwner, getUserId } from '../src/services/authService.js';
import { getConfig, ConfigError } from '../src/config/env.js';
import { snowflakeToTimestamp } from '../src/commands/central/ping.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import {
  generateTestKeys,
  signBody,
  pingInteraction,
  commandInteraction,
  snowflakeNow,
} from '../scripts/lib/signing.js';

const OWNER = '222222222222222222';
const STRANGER = '111111111111111111';
let keys;
let env;

before(async () => {
  keys = await generateTestKeys();
  env = { DISCORD_PUBLIC_KEY: keys.publicKeyHex, OWNER_ID: OWNER, APP_NAME: 'Kaiky Assistant' };
});

async function signedPost(payload, { tamper } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = await signBody(keys.privateKey, body);
  const sent = tamper ? tamper(body) : body;
  return worker.fetch(new Request('http://localhost/', { method: 'POST', headers, body: sent }), env, {});
}

describe('HTTP', () => {
  test('GET / responde que está online', async () => {
    const res = await worker.fetch(new Request('http://localhost/'), env, {});
    assert.equal(res.status, 200);
    assert.match(await res.text(), /online/);
  });

  test('rota desconhecida → 404', async () => {
    const res = await worker.fetch(new Request('http://localhost/admin'), env, {});
    assert.equal(res.status, 404);
  });

  test('método não permitido → 405', async () => {
    const res = await worker.fetch(new Request('http://localhost/', { method: 'PUT' }), env, {});
    assert.equal(res.status, 405);
  });

  test('sem DISCORD_PUBLIC_KEY → 500 sem vazar detalhes', async () => {
    const res = await worker.fetch(new Request('http://localhost/', { method: 'POST', body: '{}' }), {}, {});
    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /DISCORD_PUBLIC_KEY/);
  });
});

describe('Assinatura Ed25519', () => {
  test('sem cabeçalhos de assinatura → 401', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/', { method: 'POST', body: JSON.stringify(pingInteraction()) }),
      env,
      {},
    );
    assert.equal(res.status, 401);
  });

  test('corpo adulterado → 401', async () => {
    const res = await signedPost(pingInteraction(), { tamper: (b) => b.replace('"type":1', '"type":2') });
    assert.equal(res.status, 401);
  });

  test('assinatura de outra chave → 401', async () => {
    const other = await generateTestKeys();
    const body = JSON.stringify(pingInteraction());
    const headers = await signBody(other.privateKey, body);
    const res = await worker.fetch(new Request('http://localhost/', { method: 'POST', headers, body }), env, {});
    assert.equal(res.status, 401);
  });

  test('assinatura em hex malformado → 401', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'X-Signature-Ed25519': 'zz', 'X-Signature-Timestamp': '1' },
        body: '{}',
      }),
      env,
      {},
    );
    assert.equal(res.status, 401);
  });

  test('hexToBytes rejeita tamanho errado e caracteres inválidos', () => {
    assert.equal(hexToBytes('abcd', 32), null);
    assert.equal(hexToBytes('g'.repeat(64), 32), null);
    assert.equal(hexToBytes('ff'.repeat(32), 32)?.length, 32);
  });
});

describe('Interações', () => {
  test('PING assinado → PONG', async () => {
    const res = await signedPost(pingInteraction());
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type'), /application\/json/);
    assert.deepEqual(await res.json(), { type: 1 });
  });

  test('/ping em servidor → mensagem com Pong', async () => {
    const res = await signedPost(commandInteraction('ping', STRANGER));
    const data = await res.json();
    assert.equal(data.type, 4);
    assert.match(data.data.content, /Pong!/);
    assert.deepEqual(data.data.allowed_mentions, { parse: [] });
  });

  test('/ping em DM também funciona', async () => {
    const res = await signedPost(commandInteraction('ping', STRANGER, { inGuild: false }));
    assert.match((await res.json()).data.content, /Pong!/);
  });

  test('JSON inválido (mas assinado) → 400', async () => {
    const res = await signedPost('{isso não é json');
    assert.equal(res.status, 400);
  });

  test('comando desconhecido → aviso efêmero', async () => {
    const res = await signedPost(commandInteraction('naoexiste'));
    const data = await res.json();
    assert.equal(data.data.flags, 64);
  });

  test('interação sem type → 400', async () => {
    const res = await signedPost({ id: snowflakeNow() });
    assert.equal(res.status, 400);
  });
});

describe('Permissões de proprietário', () => {
  const config = { ownerId: OWNER, appName: 'Teste' };
  const adminCommand = {
    data: { name: 'admin-teste', description: 'x' },
    ownerOnly: true,
    execute: async () => new Response('ok'),
  };

  test('getUserId lê member.user (servidor) e user (DM)', () => {
    assert.equal(getUserId(commandInteraction('x', OWNER)), OWNER);
    assert.equal(getUserId(commandInteraction('x', OWNER, { inGuild: false })), OWNER);
  });

  test('isOwner: verdadeiro só para OWNER_ID', () => {
    assert.equal(isOwner(commandInteraction('x', OWNER), config), true);
    assert.equal(isOwner(commandInteraction('x', STRANGER), config), false);
  });

  test('sem OWNER_ID configurado, ninguém é proprietário', () => {
    assert.equal(isOwner(commandInteraction('x', OWNER), { ownerId: null }), false);
    assert.equal(getConfig({ DISCORD_PUBLIC_KEY: 'a'.repeat(64), OWNER_ID: 'abc' }).ownerId, null);
  });

  test('getConfig rejeita chave pública inválida', () => {
    assert.throws(() => getConfig({ DISCORD_PUBLIC_KEY: '123' }), ConfigError);
  });

  test('comando ownerOnly bloqueia estranhos e libera o dono', async () => {
    const denied = await runCommand(adminCommand, commandInteraction('admin-teste', STRANGER), { config });
    const deniedData = await denied.json();
    assert.equal(deniedData.data.flags, 64);
    assert.match(deniedData.data.content, /restrito ao proprietário/);

    const allowed = await runCommand(adminCommand, commandInteraction('admin-teste', OWNER), { config });
    assert.equal(await allowed.text(), 'ok');
  });

  test('erro dentro de um comando vira mensagem amigável', async () => {
    const broken = {
      data: { name: 'quebrado', description: 'x' },
      execute: async () => {
        throw new Error('falha simulada');
      },
    };
    const original = console.error;
    console.error = () => {}; // silencia o log esperado durante o teste
    try {
      const res = await runCommand(broken, commandInteraction('quebrado'), { config });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.match(data.data.content, /Ocorreu um erro/);
      assert.doesNotMatch(data.data.content, /falha simulada/);
    } finally {
      console.error = original;
    }
  });
});

describe('Utilidades', () => {
  test('snowflakeToTimestamp converte ID do Discord em data', () => {
    // Exemplo da documentação do Discord: 175928847299117063 → 2016-04-30T11:18:25.796Z
    assert.equal(new Date(snowflakeToTimestamp('175928847299117063')).toISOString(), '2016-04-30T11:18:25.796Z');
  });

  test('definições de comando seguem as regras do Discord', () => {
    for (const def of getCommandDefinitions()) {
      assert.match(def.name, /^[-_\p{L}\p{N}]{1,32}$/u);
      assert.equal(def.name, def.name.toLowerCase());
      assert.ok(def.description.length >= 1 && def.description.length <= 100);
      assert.equal(def.type, 1);
    }
  });
});
