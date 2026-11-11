// Testes do /github (FASE 4) com a API do GitHub SIMULADA. Nenhuma chamada real.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as github from '../src/services/githubService.js';
import githubCommand from '../src/commands/projetos/github.js';
import { commandInteraction } from '../scripts/lib/signing.js';

const TOKEN = 'token-falso-SECRETO-de-teste-123456';
const USER = 'KaikyBrener';

let chamadas;
let logs;
let originalWarn;

/** GitHub falso: responde conforme o caminho pedido. */
function githubFalso(rotas) {
  return async (url, init) => {
    chamadas.push({ url, init });
    const caminho = url.replace('https://api.github.com', '');
    const rota = Object.entries(rotas).find(([prefixo]) => caminho.startsWith(prefixo));
    if (!rota) return new Response('{}', { status: 404 });
    const [status, corpo, headers] = rota[1];
    return new Response(JSON.stringify(corpo), { status, headers });
  };
}

beforeEach(() => {
  chamadas = [];
  logs = [];
  originalWarn = console.warn;
  console.warn = (l) => logs.push(String(l));
});
afterEach(() => {
  console.warn = originalWarn;
});

const repo = (name, extra = {}) => ({ name, private: false, description: '', open_issues_count: 0, pushed_at: '2026-11-10T12:00:00Z', ...extra });
const issue = (number, title, extra = {}) => ({ number, title, updated_at: '2026-11-10T12:00:00Z', ...extra });

describe('Somente leitura e segurança do token', () => {
  test('todas as chamadas são GET, com os cabeçalhos certos', async () => {
    const fetchImpl = githubFalso({ '/user/repos': [200, [repo('a')]] });
    await github.listarRepos({ token: TOKEN, username: USER, fetchImpl });
    const [{ url, init }] = chamadas;
    assert.equal(init.method, 'GET');
    assert.equal('body' in init, false);
    assert.equal(url, 'https://api.github.com/user/repos?affiliation=owner&sort=pushed&per_page=10');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers['X-GitHub-Api-Version'], '2026-03-10');
    assert.ok(init.headers['User-Agent']);
  });

  test('o módulo não contém nenhum método de escrita', async () => {
    const { readFile } = await import('node:fs/promises');
    const codigo = await readFile('src/services/githubService.js', 'utf8');
    assert.doesNotMatch(codigo, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  });

  test('erro do GitHub: token NÃO aparece no log nem na resposta', async () => {
    globalThis.__f = githubFalso({ '/user/repos': [401, { message: 'Bad credentials' }] });
    const original = globalThis.fetch;
    globalThis.fetch = globalThis.__f;
    try {
      const interaction = { ...commandInteraction('github'), data: { name: 'github', options: [{ name: 'repos', type: 1 }] } };
      const texto = await githubCommand.execute(interaction, { env: { GITHUB_TOKEN: TOKEN, GITHUB_USERNAME: USER } });
      assert.match(texto, /token do GitHub é inválido ou expirou/);
      assert.equal(texto.includes(TOKEN), false);
      assert.equal(logs.length, 1);
      assert.equal(logs[0].includes(TOKEN), false);
      assert.deepEqual(JSON.parse(logs[0]), { level: 'warn', event: 'github_error', command: 'github', reason: 'token_invalido', http_status: 401 });
    } finally {
      globalThis.fetch = original;
    }
  });

  test('sem token configurado: mensagem clara e NENHUMA chamada à API', async () => {
    const interaction = { ...commandInteraction('github'), data: { name: 'github', options: [{ name: 'repos', type: 1 }] } };
    const texto = await githubCommand.execute(interaction, { env: { GITHUB_USERNAME: USER } });
    assert.match(texto, /não está configurada/);
    assert.equal(chamadas.length, 0);
  });

  test('o comando é adiado, efêmero e restrito ao proprietário', () => {
    assert.equal(githubCommand.deferred, true);
    assert.equal(githubCommand.ephemeral, true);
    assert.equal('ownerOnly' in githubCommand, false);
  });
});

describe('Erros traduzidos', () => {
  const casos = [
    [403, { 'x-ratelimit-remaining': '0' }, 'rate_limit'],
    [429, {}, 'rate_limit'],
    [403, {}, 'sem_permissao'],
    [404, {}, 'nao_encontrado'],
    [500, {}, 'erro_api'],
  ];
  for (const [status, headers, kind] of casos) {
    test(`${status} ${JSON.stringify(headers)} → ${kind}`, async () => {
      const fetchImpl = githubFalso({ '/user/repos': [status, {}, headers] });
      await assert.rejects(github.listarRepos({ token: TOKEN, username: USER, fetchImpl }), (e) => e.kind === kind);
    });
  }

  test('nome de repositório malicioso é recusado ANTES de chamar a API', async () => {
    const fetchImpl = githubFalso({});
    for (const ruim of ['../../user', 'a/b', 'a b', '..', '']) {
      await assert.rejects(github.listarIssues({ token: TOKEN, username: USER, repo: ruim || '.', fetchImpl }), (e) => e.kind === 'entrada_invalida');
    }
    assert.equal(chamadas.length, 0);
  });
});

describe('Repositórios, issues e atividade', () => {
  test('repos: formatação com privado, push e abertos', async () => {
    const fetchImpl = githubFalso({ '/user/repos': [200, [repo('Kaiky-Assistent', { private: true, open_issues_count: 2, description: 'Bot **pessoal**' })]] });
    const texto = github.formatarRepos(await github.listarRepos({ token: TOKEN, username: USER, fetchImpl }));
    assert.match(texto, /🔒 \*\*Kaiky\\-Assistent\*\* · push 10\/11 09:00 · abertos: 2 — Bot \\\*\\\*pessoal\\\*\\\*/);
  });

  test('issues de um repositório: pull requests ficam de fora', async () => {
    const fetchImpl = githubFalso({
      '/repos/KaikyBrener/Prova-On/issues': [200, [issue(1, 'Bug no login'), issue(2, 'PR', { pull_request: {} })]],
    });
    const issues = await github.listarIssues({ token: TOKEN, username: USER, repo: 'Prova-On', fetchImpl });
    assert.deepEqual(issues.map((i) => i.numero), [1]);
    assert.match(chamadas[0].url, /state=open/);
  });

  test('issues sem repositório: consulta só os repos com algo aberto (máx. 5)', async () => {
    const repos = [repo('a', { open_issues_count: 1 }), repo('b'), ...Array.from({ length: 6 }, (_, i) => repo(`c${i}`, { open_issues_count: 1 }))];
    const fetchImpl = githubFalso({ '/user/repos': [200, repos], '/repos/': [200, [issue(7, 'x')]] });
    const issues = await github.listarIssues({ token: TOKEN, username: USER, fetchImpl });
    const consultados = chamadas.filter((c) => c.url.includes('/repos/KaikyBrener/')).length;
    assert.equal(consultados, 5);
    assert.equal(issues.length, 5);
  });

  test('atividade: eventos descritos em português', async () => {
    const fetchImpl = githubFalso({
      '/users/KaikyBrener/events': [200, [
        { type: 'PushEvent', repo: { name: 'KaikyBrener/Kaiky-Assistent' }, payload: { size: 3 }, created_at: '2026-11-11T13:00:00Z' },
        { type: 'IssuesEvent', repo: { name: 'KaikyBrener/Prova-On' }, payload: { action: 'opened', issue: { number: 4 } }, created_at: '2026-11-11T12:00:00Z' },
        { type: 'AlgoNovoEvent', repo: { name: 'x/y' }, created_at: '2026-11-11T11:00:00Z' },
      ]],
    });
    const texto = github.formatarAtividade(await github.listarAtividade({ token: TOKEN, username: USER, fetchImpl }));
    assert.match(texto, /📤 push em KaikyBrener\/Kaiky\\-Assistent \(3 commits\) · 11\/11 10:00/);
    assert.match(texto, /🐛 opened issue #4 em KaikyBrener\/Prova\\-On/);
    assert.match(texto, /AlgoNovoEvent em x\/y/);
  });
});
