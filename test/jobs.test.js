// Testes da FASE 3 (Cron): lembretes, relatório diário e anti-duplicidade.
// Usa um D1 local real (getPlatformProxy) e um Discord SIMULADO (fetch falso).

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarD1DeTeste } from './helpers/d1.js';
import { runScheduledJobs } from '../src/jobs/index.js';
import { criarTarefa, concluirTarefa } from '../src/database/tarefasRepository.js';
import { fromLocal } from '../src/services/dateTime.js';

const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${'Tk_'.repeat(20)}`;
const MIN = 60 * 1000;

let d1;
let env;
let enviadas; // mensagens que "chegaram" ao Discord
let respostaDiscord; // status que o Discord simulado devolve
let logs;
const originais = {};

before(async () => {
  d1 = await criarD1DeTeste();
  env = { DB: d1.db, DISCORD_WEBHOOK_URL: WEBHOOK };
});
after(async () => {
  await d1.dispose();
});

beforeEach(async () => {
  await d1.limpar();
  enviadas = [];
  respostaDiscord = 200;
  logs = [];
  originais.fetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith(`${WEBHOOK}?wait=true`), 'só o webhook pode ser chamado');
    if (respostaDiscord === 200) enviadas.push(JSON.parse(init.body).content);
    return new Response('{}', { status: respostaDiscord });
  };
  for (const nivel of ['log', 'warn', 'error']) {
    originais[nivel] = console[nivel];
    console[nivel] = (linha) => logs.push(String(linha));
  }
});
afterEach(() => {
  globalThis.fetch = originais.fetch;
  for (const nivel of ['log', 'warn', 'error']) console[nivel] = originais[nivel];
});

let seq = 0;
async function novaTarefa({ titulo = 'Tarefa', prazo = null, agora, contexto = 'pessoal' }) {
  const { tarefa } = await criarTarefa(d1.db, { titulo, contexto, prazo, interactionId: `t${++seq}`, agora });
  return tarefa;
}

// Um dia de referência: quinta, 19/11/2026, horários de Brasília.
const em = (hora, minuto = 0, dia = 19) => fromLocal(2026, 11, dia, hora, minuto);

describe('Lembretes', () => {
  test('tarefa que vence em 30 min recebe UM lembrete, mesmo com o Cron rodando de novo', async () => {
    // 06:00: todas as execuções deste teste acontecem antes do relatório das 08:00.
    const agora = em(6, 0);
    const t = await novaTarefa({ titulo: 'Pagar conta', prazo: agora + 30 * MIN, agora });

    assert.equal((await runScheduledJobs(env, agora)).lembretes, 'enviado');
    assert.equal(enviadas.length, 1);
    assert.match(enviadas[0], new RegExp(`⏰ \\*\\*Lembrete\\*\\*\\n• \\*\\*#${t.id}\\*\\* · Pagar conta`));
    assert.match(enviadas[0], /vence em 30 min/);

    assert.equal((await runScheduledJobs(env, agora + 5 * MIN)).lembretes, 'nada_a_enviar');
    assert.equal((await runScheduledJobs(env, agora + 60 * MIN)).lembretes, 'nada_a_enviar', 'nem depois de vencer');
    assert.equal(enviadas.length, 1);
  });

  test('só lembra quando falta até 1 hora', async () => {
    const agora = em(6, 0);
    await novaTarefa({ prazo: agora + 3 * 60 * MIN, agora });
    assert.equal((await runScheduledJobs(env, agora)).lembretes, 'nada_a_enviar');
    assert.equal((await runScheduledJobs(env, agora + 2 * 60 * MIN + 5 * MIN)).lembretes, 'enviado');
  });

  test('tarefas concluídas ou sem prazo não geram lembrete', async () => {
    const agora = em(6, 0);
    const feita = await novaTarefa({ prazo: agora + 10 * MIN, agora });
    await concluirTarefa(d1.db, { id: feita.id, agora });
    await novaTarefa({ titulo: 'Sem prazo', agora });
    assert.equal((await runScheduledJobs(env, agora)).lembretes, 'nada_a_enviar');
    assert.equal(enviadas.length, 0);
  });

  test('vários lembretes na mesma execução vão numa única mensagem', async () => {
    const agora = em(6, 0);
    await novaTarefa({ titulo: 'A', prazo: agora + 10 * MIN, agora });
    await novaTarefa({ titulo: 'B', prazo: agora + 20 * MIN, agora });
    await runScheduledJobs(env, agora);
    assert.equal(enviadas.length, 1);
    assert.match(enviadas[0], /Lembretes\*\*[\s\S]*· A ·[\s\S]*· B ·/);
  });

  test('falha no Discord libera a reserva e a PRÓXIMA execução envia', async () => {
    const agora = em(6, 0);
    await novaTarefa({ prazo: agora + 10 * MIN, agora });

    respostaDiscord = 500;
    assert.equal((await runScheduledJobs(env, agora)).lembretes, 'falhou');
    const reservas = await d1.db.prepare('SELECT COUNT(*) AS n FROM notificacoes').first();
    assert.equal(reservas.n, 0, 'reserva desfeita');

    respostaDiscord = 200;
    assert.equal((await runScheduledJobs(env, agora + 5 * MIN)).lembretes, 'enviado');
    assert.equal(enviadas.length, 1);
  });

  test('duas execuções do Cron AO MESMO TEMPO enviam o lembrete uma única vez', async () => {
    const agora = em(6, 0);
    await novaTarefa({ prazo: agora + 10 * MIN, agora });
    const [a, b] = await Promise.all([runScheduledJobs(env, agora), runScheduledJobs(env, agora)]);
    assert.deepEqual([a.lembretes, b.lembretes].sort(), ['enviado', 'ja_reservados'].sort());
    assert.equal(enviadas.length, 1);
  });

  test('a URL do webhook (que contém o token) nunca aparece nos logs', async () => {
    const agora = em(6, 0);
    await novaTarefa({ prazo: agora + 10 * MIN, agora });
    respostaDiscord = 500;
    await runScheduledJobs(env, agora);
    assert.ok(logs.length > 0);
    assert.equal(logs.some((l) => l.includes('Tk_Tk_') || l.includes('webhooks/')), false);
  });
});

describe('Relatório diário', () => {
  test('antes das 08:00 não envia; a partir das 08:00 envia UMA vez por dia', async () => {
    assert.equal((await runScheduledJobs(env, em(7, 55))).relatorio, 'antes_do_horario');
    assert.equal((await runScheduledJobs(env, em(8, 0))).relatorio, 'enviado');
    assert.equal((await runScheduledJobs(env, em(8, 5))).relatorio, 'ja_enviado');
    assert.equal((await runScheduledJobs(env, em(23, 55))).relatorio, 'ja_enviado');
    assert.equal((await runScheduledJobs(env, em(8, 0, 20))).relatorio, 'enviado', 'no dia seguinte, de novo');
    assert.equal(enviadas.length, 2);
  });

  test('sem pendências: "Tudo em dia"', async () => {
    await runScheduledJobs(env, em(8, 0));
    assert.match(enviadas[0], /Relatório de 19\/11\/2026/);
    assert.match(enviadas[0], /Tudo em dia!/);
  });

  test('mostra pendentes, atrasadas, que vencem hoje e o resumo da semana', async () => {
    const ontem = em(10, 0, 18);
    const agora = em(8, 0);
    await novaTarefa({ titulo: 'Atrasada', prazo: em(9, 0, 18), agora: ontem });
    await novaTarefa({ titulo: 'Vence hoje', prazo: em(17, 0), agora: ontem, contexto: 'profissional' });
    await novaTarefa({ titulo: 'Semana que vem', prazo: em(9, 0, 26), agora: ontem });
    await novaTarefa({ titulo: 'Sem prazo', agora: ontem });

    // O lembrete da "Atrasada" sai junto; aqui olhamos só o relatório.
    await runScheduledJobs(env, agora);
    const relatorio = enviadas.find((m) => m.includes('Relatório'));
    assert.match(relatorio, /Pendentes: \*\*4\*\* \(pessoal 3 · profissional 1 · sem prazo 1\)/);
    assert.match(relatorio, /Atrasadas \(1\)\*\*\n• ⬜ \*\*#\d+\*\* · pessoal · Atrasada · 📅 18\/11 09:00 · ⚠️ atrasada/);
    assert.match(relatorio, /Vencem hoje \(1\)\*\*\n• ⬜ \*\*#\d+\*\* · profissional · Vence hoje · 📅 19\/11 17:00/);
    assert.doesNotMatch(relatorio, /Semana que vem/);
    assert.match(relatorio, /Semana: 4 criada\(s\) · 0 concluída\(s\)/);
  });

  test('falha no envio libera o relatório para a próxima execução', async () => {
    respostaDiscord = 500;
    assert.equal((await runScheduledJobs(env, em(8, 0))).relatorio, 'falhou');
    respostaDiscord = 200;
    assert.equal((await runScheduledJobs(env, em(8, 5))).relatorio, 'enviado');
  });
});

describe('Configuração', () => {
  test('webhook inválido: não envia, não reserva nada e registra o motivo', async () => {
    const agora = em(8, 0);
    await novaTarefa({ prazo: agora + 10 * MIN, agora });
    const resultado = await runScheduledJobs({ DB: d1.db, DISCORD_WEBHOOK_URL: 'https://exemplo.com/x' }, agora);
    // O #dashboard (opcional) também aparece no resultado; aqui ele não está configurado.
    assert.deepEqual(resultado, { lembretes: 'nao_configurado', relatorio: 'nao_configurado', dashboard: 'nao_configurado' });
    assert.equal((await d1.db.prepare('SELECT COUNT(*) AS n FROM notificacoes').first()).n, 0);
    assert.ok(logs.some((l) => l.includes('webhook_url_invalid')));
  });
});
