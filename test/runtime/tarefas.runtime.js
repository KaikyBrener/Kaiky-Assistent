// Testes de INTEGRAÇÃO do /tarefa no runtime real (workerd) com um D1 LOCAL.
// O banco é criado do zero para cada teste e recebe as migrations da pasta
// /migrations. Nada aqui toca o seu banco real na Cloudflare.
//
// Uso: npm run test:runtime

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';

import { generateTestKeys, signBody, commandInteraction, snowflakeNow } from '../../scripts/lib/signing.js';

const OWNER = '222222222222222222';
const STRANGER = '111111111111111111';
const keys = await generateTestKeys();

const server = createTestHarness({
  workers: [
    {
      configPath: './wrangler.jsonc',
      secrets: { DISCORD_PUBLIC_KEY: keys.publicKeyHex, OWNER_ID: OWNER },
    },
  ],
});

before(async () => {
  await server.listen();
});
beforeEach(async () => {
  // Banco limpo + migrations aplicadas antes de cada teste.
  await server.getWorker().applyD1Migrations('DB');
});
afterEach(async () => {
  await server.reset(); // apaga o banco local de teste
});
after(async () => {
  await server.close();
});

/** Monta a interação de um subcomando, igual ao que o Discord envia. */
function tarefaInteraction(sub, values = {}, userId = OWNER) {
  const base = commandInteraction('tarefa', userId);
  const options = Object.entries(values).map(([name, value]) => ({
    name,
    value,
    type: typeof value === 'number' ? 4 : typeof value === 'boolean' ? 5 : 3,
  }));
  return { ...base, id: snowflakeNow() + String(Math.floor(Math.random() * 1000)).padStart(3, '0'), data: { ...base.data, options: [{ name: sub, type: 1, options }] } };
}

async function send(interaction) {
  const body = JSON.stringify(interaction);
  const res = await server.fetch('/', { method: 'POST', body, headers: await signBody(keys.privateKey, body) });
  const data = await res.json();
  return { status: res.status, content: data.data?.content, flags: data.data?.flags };
}

async function contarTarefas() {
  const env = await server.getWorker().getEnv();
  return (await env.DB.prepare('SELECT COUNT(*) AS total FROM tarefas').first()).total;
}

describe('/tarefa no workerd com D1', () => {
  test('criar → listar → concluir → excluir', async () => {
    const criada = await send(tarefaInteraction('criar', { titulo: 'Estudar banco de dados' }));
    assert.match(criada.content, /Tarefa criada: ⬜ \*\*#1\*\* · pessoal · Estudar banco de dados/);
    assert.equal(criada.flags, 64, 'resposta deve ser efêmera');

    await send(tarefaInteraction('criar', { titulo: 'Relatório semanal', contexto: 'profissional' }));

    const lista = await send(tarefaInteraction('listar'));
    assert.match(lista.content, /#1\*\* · pessoal/);
    assert.match(lista.content, /#2\*\* · profissional/);

    const filtrada = await send(tarefaInteraction('listar', { contexto: 'profissional' }));
    assert.doesNotMatch(filtrada.content, /#1\*\*/);
    assert.match(filtrada.content, /#2\*\*/);

    assert.match((await send(tarefaInteraction('concluir', { id: 1 }))).content, /🎉 Concluída: ✅/);
    assert.match((await send(tarefaInteraction('concluir', { id: 1 }))).content, /já estava concluída/);

    const pendentes = await send(tarefaInteraction('listar'));
    assert.doesNotMatch(pendentes.content, /#1\*\*/, 'concluída some da lista padrão');
    const todas = await send(tarefaInteraction('listar', { todas: true }));
    assert.match(todas.content, /✅ \*\*#1\*\*/);

    assert.match((await send(tarefaInteraction('excluir', { id: 2 }))).content, /🗑️ Excluída: #2/);
    assert.match((await send(tarefaInteraction('excluir', { id: 2 }))).content, /não encontrada/);
    assert.equal(await contarTarefas(), 1);
  });

  test('M3: a MESMA interação enviada duas vezes cria só UMA tarefa', async () => {
    const interacao = tarefaInteraction('criar', { titulo: 'Pagar conta' });
    const primeira = await send(interacao);
    const segunda = await send(interacao); // replay dentro da janela de 5 min
    assert.match(primeira.content, /Tarefa criada/);
    assert.match(segunda.content, /já tinha sido processada/);
    assert.equal(await contarTarefas(), 1);
  });

  test('quem não é o proprietário é bloqueado e nada é gravado', async () => {
    const res = await send(tarefaInteraction('criar', { titulo: 'invasão' }, STRANGER));
    assert.match(res.content, /restrito ao proprietário/);
    assert.equal(await contarTarefas(), 0);
  });

  test('validação de entrada no servidor', async () => {
    assert.match((await send(tarefaInteraction('criar', { titulo: '    ' }))).content, /não pode ficar vazio/);
    assert.match((await send(tarefaInteraction('criar', { titulo: 'x'.repeat(201) }))).content, /no máximo 200/);
    assert.match((await send(tarefaInteraction('criar', { titulo: 'a', contexto: 'outro' }))).content, /Contexto deve ser/);
    assert.match((await send(tarefaInteraction('concluir', { id: 0 }))).content, /número de tarefa válido/);
    assert.equal(await contarTarefas(), 0);
  });

  test('SQL injection no título é gravado como texto comum', async () => {
    const malicioso = "x'); DROP TABLE tarefas; --";
    await send(tarefaInteraction('criar', { titulo: malicioso }));
    const env = await server.getWorker().getEnv();
    const linha = await env.DB.prepare('SELECT titulo FROM tarefas WHERE id = 1').first();
    assert.equal(linha.titulo, malicioso);
    assert.equal(await contarTarefas(), 1, 'a tabela continua existindo');
  });

  test('título com quebras de linha e markdown é limpo e escapado', async () => {
    const res = await send(tarefaInteraction('criar', { titulo: '  **negrito**\n\n_itálico_  ' }));
    assert.match(res.content, /\\\*\\\*negrito\\\*\\\* \\_itálico\\_/);
  });
});
