// Teste de fumaça LOCAL: sobe o Worker com `wrangler dev` (runtime real da
// Cloudflare, rodando na sua máquina) e envia requisições assinadas.
//
// Uso: npm run test:local
//
// O script gera uma chave de teste e a injeta com --var, então ele não usa
// (nem precisa) dos seus segredos reais.

import { spawn } from 'node:child_process';
import { generateTestKeys, signBody, pingInteraction, commandInteraction } from './lib/signing.js';

const PORT = 8787 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/`;

const { privateKey, publicKeyHex } = await generateTestKeys();

const wrangler = spawn(
  'npx',
  [
    'wrangler', 'dev',
    '--ip', '127.0.0.1',
    '--port', String(PORT),
    '--var', `DISCORD_PUBLIC_KEY:${publicKeyHex}`,
    '--var', 'OWNER_ID:222222222222222222',
    '--show-interactive-dev-session=false',
    '--log-level', 'warn',
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    // Grupo de processos próprio: permite encerrar o wrangler E o workerd juntos.
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32', // no Windows, "npx" é um .cmd
  },
);
let wranglerOutput = '';
wrangler.stdout.on('data', (d) => (wranglerOutput += d));
wrangler.stderr.on('data', (d) => (wranglerOutput += d));

function stop(code) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(wrangler.pid), '/T', '/F']);
    } else {
      process.kill(-wrangler.pid, 'SIGTERM'); // sinal para o grupo inteiro
    }
  } catch {
    // processo já tinha terminado
  }
  setTimeout(() => process.exit(code), 300);
}

async function waitForServer(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(wranglerOutput);
  throw new Error('wrangler dev não respondeu a tempo.');
}

async function post(body, headers) {
  const res = await fetch(BASE, { method: 'POST', body, headers });
  const contentType = res.headers.get('Content-Type') ?? '';
  const data = contentType.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? '✔' : '✖'} ${name}${condition ? '' : ` → ${JSON.stringify(detail)}`}`);
}

try {
  await waitForServer();
  console.log(`Worker local em ${BASE}\n`);

  const health = await fetch(BASE);
  check('GET / responde 200', health.status === 200, health.status);

  const noSig = await post(JSON.stringify(pingInteraction()), { 'Content-Type': 'application/json' });
  check('POST sem assinatura → 401', noSig.status === 401, noSig);

  const pingBody = JSON.stringify(pingInteraction());
  const badHeaders = await signBody(privateKey, pingBody);
  const tampered = await post(pingBody.replace('"type":1', '"type":2'), badHeaders);
  check('Corpo adulterado → 401', tampered.status === 401, tampered);

  const ping = await post(pingBody, await signBody(privateKey, pingBody));
  check('PING assinado → PONG (type 1)', ping.status === 200 && ping.data.type === 1, ping);

  const cmdBody = JSON.stringify(commandInteraction('ping'));
  const cmd = await post(cmdBody, await signBody(privateKey, cmdBody));
  check(
    '/ping → mensagem "Pong!"',
    cmd.status === 200 && cmd.data.type === 4 && cmd.data.data.content.includes('Pong!'),
    cmd,
  );
  if (cmd.data?.data?.content) console.log(`   resposta: ${cmd.data.data.content}`);

  const unknownBody = JSON.stringify(commandInteraction('naoexiste'));
  const unknown = await post(unknownBody, await signBody(privateKey, unknownBody));
  check('Comando desconhecido → aviso efêmero', unknown.data?.data?.flags === 64, unknown);
} catch (error) {
  console.error(error);
  stop(1);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
stop(failed ? 1 : 0);
