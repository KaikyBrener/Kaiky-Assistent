// Integração no workerd: /bug, formulários (MODAL_SUBMIT) e descrição das tarefas.

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';

import { generateTestKeys, signBody, commandInteraction, snowflakeNow } from '../../scripts/lib/signing.js';

const OWNER = '222222222222222222';
const keys = await generateTestKeys();
const server = createTestHarness({
  workers: [{ configPath: './wrangler.jsonc', secrets: { DISCORD_PUBLIC_KEY: keys.publicKeyHex, OWNER_ID: OWNER } }],
});

before(async () => {
  await server.listen();
});
beforeEach(async () => {
  await server.getWorker().applyD1Migrations('DB');
});
afterEach(async () => {
  await server.reset();
});
after(async () => {
  await server.close();
});

let seq = 0;
const novoId = () => `${snowflakeNow()}${String(++seq).padStart(3, '0')}`;

function slash(name, sub, values = {}) {
  const base = commandInteraction(name, OWNER);
  const options = Object.entries(values).map(([n, value]) => ({ name: n, value, type: typeof value === 'number' ? 4 : typeof value === 'boolean' ? 5 : 3 }));
  return { ...base, id: novoId(), data: { ...base.data, options: [{ name: sub, type: 1, options }] } };
}
function modal(customId, values) {
  return {
    ...commandInteraction('x', OWNER),
    id: novoId(),
    type: 5,
    data: { custom_id: customId, components: Object.entries(values).map(([custom_id, value]) => ({ type: 18, component: { type: 4, custom_id, value } })) },
  };
}
async function send(payload) {
  const body = JSON.stringify(payload);
  const res = await server.fetch('/', { method: 'POST', body, headers: await signBody(keys.privateKey, body) });
  return res.json();
}

describe('workerd: bugs e formulários', () => {
  test('migration 0003 cria bugs e estado, e adiciona tipo/descricao em tarefas', async () => {
    const env = await server.getWorker().getEnv();
    const tabelas = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name);
    for (const t of ['tarefas', 'notificacoes', 'bugs', 'estado']) assert.ok(tabelas.includes(t), t);
    const colunas = (await env.DB.prepare('PRAGMA table_info(tarefas)').all()).results.map((r) => r.name);
    assert.ok(colunas.includes('tipo') && colunas.includes('descricao'));
  });

  test('/bug registrar → formulário; envio assinado → bug salvo; /bug ver mostra tudo', async () => {
    const form = await send(slash('bug', 'registrar', { sistema: 'Horus' }));
    assert.equal(form.type, 9);

    const salvo = await send(modal('bug:registrar', { titulo: 'Botão salvar sem estilo', sistema: 'Horus', descricao: 'Linha 1\nLinha 2' }));
    assert.match(salvo.data.content, /Bug registrado/);

    await send(modal('bug:resolver:1', { solucao: 'Trocado para `btn btn-primary`.', referencia: 'PR 879' }));
    const ver = await send(slash('bug', 'ver', { id: 1 }));
    assert.match(ver.data.embeds[0].description, /Linha 1\nLinha 2/);
    assert.match(ver.data.embeds[1].description, /btn btn-primary/);
  });

  test('/tarefa criar descrever:True → formulário; envio → descrição salva', async () => {
    const form = await send(slash('tarefa', 'criar', { titulo: 'Documentar PR', tipo: 'reuniao', descrever: true }));
    assert.equal(form.type, 9);
    assert.equal(form.data.custom_id, 'tarefa:descrever:1');
    const salvo = await send(modal('tarefa:descrever:1', { descricao: 'Pauta:\n- item 1\n- item 2' }));
    assert.match(salvo.data.content, /👥 reunião · pessoal · Documentar PR · 📄/);
  });
});
