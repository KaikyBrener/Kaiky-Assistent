// Testes de INTEGRAÇÃO no runtime real da Cloudflare (workerd), usando
// `createTestHarness()` do próprio Wrangler. Não precisa de nenhuma
// dependência nova e não acessa sua conta Cloudflare: tudo roda local.
//
// Uso: npm run test:runtime
//
// Diferença para `npm test`: lá o código roda no Node.js; aqui ele roda no
// MESMO motor usado em produção, carregando o wrangler.jsonc de verdade.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';

import { generateTestKeys, signBody, pingInteraction, commandInteraction } from '../../scripts/lib/signing.js';

const OWNER = '222222222222222222';
const keys = await generateTestKeys(); // chave de TESTE, gerada a cada execução

const server = createTestHarness({
  workers: [
    {
      configPath: './wrangler.jsonc',
      // Sobrescreve os segredos só para o teste: seus segredos reais não são usados.
      secrets: { DISCORD_PUBLIC_KEY: keys.publicKeyHex, OWNER_ID: OWNER },
    },
  ],
});

before(async () => {
  await server.listen();
});
after(async () => {
  await server.close();
});

async function post(body, headers = {}) {
  const res = await server.fetch('/', { method: 'POST', body, headers });
  const type = res.headers.get('Content-Type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}

async function waitForLog(fragment, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.getLogs().some((log) => log.message.includes(fragment))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function signed(payload, timestamp) {
  const body = JSON.stringify(payload);
  return post(body, await signBody(keys.privateKey, body, timestamp));
}

// Mesmas 6 verificações do antigo scripts/smoke-test.js...
describe('workerd: verificações herdadas do smoke test', () => {
  test('GET / responde 200', async () => {
    assert.equal((await server.fetch('/')).status, 200);
  });

  test('POST sem assinatura → 401', async () => {
    assert.equal((await post(JSON.stringify(pingInteraction()))).status, 401);
  });

  test('corpo adulterado → 401', async () => {
    const body = JSON.stringify(pingInteraction());
    const headers = await signBody(keys.privateKey, body);
    assert.equal((await post(body.replace('"type":1', '"type":2'), headers)).status, 401);
  });

  test('PING assinado → PONG (type 1)', async () => {
    const res = await signed(pingInteraction());
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { type: 1 });
  });

  test('/ping → mensagem "Pong!"', async () => {
    const res = await signed(commandInteraction('ping'));
    assert.equal(res.data.type, 4);
    assert.match(res.data.data.content, /Pong!/);
  });

  test('comando desconhecido → aviso efêmero', async () => {
    assert.equal((await signed(commandInteraction('naoexiste'))).data.data.flags, 64);
  });
});

// ...e as correções da auditoria, agora conferidas no runtime real.
describe('workerd: correções da auditoria', () => {
  test('M1: corpo de 1 MB em stream (sem Content-Length) → 413', async () => {
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= 1024 * 1024) return controller.close();
        sent += 16 * 1024;
        controller.enqueue(new Uint8Array(16 * 1024));
      },
    });
    server.clearLogs();
    // O Worker responde 413 e PARA de ler enquanto o cliente ainda envia.
    // Às vezes a conexão é encerrada antes de o cliente ler a resposta
    // ("fetch failed"). As duas situações são corretas: o que importa é
    // que o Worker recusou o corpo, e isso fica registrado no log.
    let status = 'conexão encerrada pelo servidor';
    try {
      status = (await server.fetch('/', { method: 'POST', body: stream, duplex: 'half' })).status;
    } catch {
      // esperado de vez em quando, ver acima
    }
    assert.ok(status === 413 || status === 'conexão encerrada pelo servidor', `status inesperado: ${status}`);
    // Os logs do runtime chegam de forma assíncrona: aguardamos até 3 s por eles.
    const refused = await waitForLog('"reason":"body_too_large"');
    assert.equal(refused, true, `o Worker deveria registrar body_too_large (status: ${status})`);
  });

  test('M2: assinatura válida com timestamp de 1 hora atrás → 401', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    assert.equal((await signed(commandInteraction('ping'), old)).status, 401);
  });

  test('M6: log JSON da interação aparece no runtime e não contém o token', async () => {
    server.clearLogs();
    const interaction = commandInteraction('ping');
    await signed(interaction);
    const messages = server.getLogs().map((log) => log.message);
    const summary = messages.find((m) => m.includes('"event":"interaction"'));
    assert.ok(summary, `log não encontrado em: ${JSON.stringify(messages)}`);
    assert.equal(JSON.parse(summary).command, 'ping');
    assert.equal(messages.some((m) => m.includes(interaction.token)), false);
  });

  test('B6: wrangler.jsonc carrega APP_NAME (vars) junto com os segredos', async () => {
    assert.match(await (await server.fetch('/')).text(), /Kaiky Assistant está online/);
  });
});
