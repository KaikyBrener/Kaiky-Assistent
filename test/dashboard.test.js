// Testes do #dashboard: uma mensagem fixa, editada a cada execução do Cron.
// D1 local real + Discord SIMULADO (guarda as mensagens em memória).

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarD1DeTeste } from './helpers/d1.js';
import { runScheduledJobs } from '../src/jobs/index.js';
import { criarTarefa } from '../src/database/tarefasRepository.js';
import { criarBug } from '../src/database/bugsRepository.js';
import { fromLocal } from '../src/services/dateTime.js';

const KAIKY = `https://discord.com/api/webhooks/123456789012345678/${'K'.repeat(68)}`;
const DASH = `https://discord.com/api/webhooks/876543210987654321/${'D'.repeat(68)}`;
const agora = fromLocal(2026, 11, 19, 6, 0); // antes das 08:00: sem relatório no meio

let d1;
let env;
let discord; // { mensagens: Map<id, texto>, chamadas: [] }
let originalFetch;
let originalLog;
let seq = 0;

before(async () => {
  d1 = await criarD1DeTeste();
  env = { DB: d1.db, DISCORD_WEBHOOK_URL: KAIKY, DISCORD_DASHBOARD_WEBHOOK_URL: DASH };
});
after(async () => {
  await d1.dispose();
});

beforeEach(async () => {
  await d1.limpar();
  await d1.db.batch([d1.db.prepare('DELETE FROM bugs'), d1.db.prepare('DELETE FROM estado')]);
  discord = { mensagens: new Map(), chamadas: [], proximoId: 100000000000000000n };
  originalFetch = globalThis.fetch;
  originalLog = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith(DASH)) return new Response('{}', { status: 200 }); // #kaiky: não interessa aqui
    const conteudo = JSON.parse(init.body).content;
    discord.chamadas.push(init.method);
    if (init.method === 'POST') {
      const id = String(discord.proximoId++);
      discord.mensagens.set(id, conteudo);
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    const id = u.split('/messages/')[1];
    if (!discord.mensagens.has(id)) return new Response('{}', { status: 404 }); // mensagem apagada
    discord.mensagens.set(id, conteudo);
    return new Response(JSON.stringify({ id }), { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(console, originalLog);
});

const tarefa = (titulo, extra = {}) =>
  criarTarefa(d1.db, { titulo, contexto: 'pessoal', interactionId: `d${++seq}`, agora: agora - 86400000, ...extra });

describe('#dashboard', () => {
  test('cria a mensagem uma vez e depois só EDITA a mesma', async () => {
    await tarefa('Primeira');
    assert.equal((await runScheduledJobs(env, agora)).dashboard, 'criado');
    assert.equal((await runScheduledJobs(env, agora + 5 * 60000)).dashboard, 'atualizado');
    assert.equal((await runScheduledJobs(env, agora + 10 * 60000)).dashboard, 'atualizado');
    assert.deepEqual(discord.chamadas, ['POST', 'PATCH', 'PATCH']);
    assert.equal(discord.mensagens.size, 1, 'o canal não enche de mensagens');
  });

  test('a mensagem reflete mudanças: tarefa nova aparece na próxima atualização', async () => {
    await runScheduledJobs(env, agora);
    const [id] = discord.mensagens.keys();
    assert.match(discord.mensagens.get(id), /Nenhuma tarefa pendente/);
    await tarefa('Nova tarefa');
    await runScheduledJobs(env, agora + 5 * 60000);
    assert.match(discord.mensagens.get(id), /Tarefas pendentes: 1\*\*\n• ⬜ \*\*#\d+\*\* · pessoal · Nova tarefa/);
  });

  test('se você apagar a mensagem, o Cron cria outra', async () => {
    await runScheduledJobs(env, agora);
    discord.mensagens.clear(); // apagada no Discord
    assert.equal((await runScheduledJobs(env, agora + 5 * 60000)).dashboard, 'criado');
    assert.deepEqual(discord.chamadas, ['POST', 'PATCH', 'POST']);
    assert.equal(discord.mensagens.size, 1);
  });

  test('duas execuções ao mesmo tempo criam UMA mensagem só', async () => {
    const [a, b] = await Promise.all([runScheduledJobs(env, agora), runScheduledJobs(env, agora)]);
    assert.deepEqual([a.dashboard, b.dashboard].sort(), ['criacao_em_andamento', 'criado']);
    assert.equal(discord.chamadas.filter((m) => m === 'POST').length, 1);
  });

  test('conteúdo: atrasadas primeiro, depois por prazo, sem prazo por último; bugs abertos', async () => {
    await tarefa('Sem prazo');
    await tarefa('Amanhã', { prazo: agora + 86400000 });
    await tarefa('Atrasada', { prazo: agora - 3600000 });
    await criarBug(d1.db, { titulo: 'Impressão em 1 coluna', sistema: 'Horus', descricao: 'x', comoReproduzir: null, interactionId: 'b1', agora });
    await runScheduledJobs(env, agora);
    const texto = [...discord.mensagens.values()][0];
    assert.match(texto, /Tarefas pendentes: 3\*\* · ⚠️ 1 atrasada\(s\)/);
    const ordem = ['Atrasada', 'Amanhã', 'Sem prazo'].map((t) => texto.indexOf(t));
    assert.deepEqual([...ordem].sort((x, y) => x - y), ordem);
    assert.match(texto, /Bugs abertos: 1\*\*\n• \*\*#\d+\*\* · Horus · Impressão em 1 coluna/);
    assert.ok(texto.length <= 2000);
  });

  test('sem o webhook do #dashboard: nada é enviado e os outros jobs seguem', async () => {
    const r = await runScheduledJobs({ DB: d1.db, DISCORD_WEBHOOK_URL: KAIKY }, agora);
    assert.equal(r.dashboard, 'nao_configurado');
    assert.equal(r.lembretes, 'nada_a_enviar');
    assert.equal(discord.chamadas.length, 0);
  });

  test('muitas tarefas: a mensagem continua dentro do limite de 2000 caracteres', async () => {
    for (let i = 0; i < 40; i++) await tarefa(`Tarefa com um título bem comprido número ${i} para testar o limite`, { prazo: agora + i * 3600000 });
    for (let i = 0; i < 12; i++) await criarBug(d1.db, { titulo: `Bug comprido número ${i} com bastante texto`, sistema: 'Horus', descricao: 'x', comoReproduzir: null, interactionId: `bb${i}`, agora });
    await runScheduledJobs(env, agora);
    const texto = [...discord.mensagens.values()][0];
    assert.ok(texto.length <= 2000, `tamanho ${texto.length}`);
    assert.match(texto, /… e mais/);
    assert.match(texto, /Bugs abertos: 12/);
  });
});
