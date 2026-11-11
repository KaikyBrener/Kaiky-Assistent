// Testes do /bug e da descrição longa das tarefas, com D1 local real.
// Os formulários (modais) são simulados como o Discord os envia.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarD1DeTeste } from './helpers/d1.js';
import bugCommand from '../src/commands/projetos/bug.js';
import tarefaCommand from '../src/commands/tarefas/tarefa.js';
import { runCommand, handleInteraction } from '../src/events/interactionHandler.js';
import { parseModalCustomId, readModalValues } from '../src/discord/modal.js';
import { commandInteraction, snowflakeNow } from '../scripts/lib/signing.js';

const OWNER = '222222222222222222';
const STRANGER = '111111111111111111';
const config = { ownerId: OWNER, appName: 'Teste' };

// Descrição real de um PR, com quebras de linha, `código` e listas.
const PR_879 = `O que mudou

* Botões: Salvar com \`btn btn-primary\` nas telas de adicionar/editar
* Impressão do apartamento: corrigidas as colunas (\`col-xs-*\` para \`col-*\`)

Obs.: o PR só mexe em \`horus-php/src/Template\`.`;

let d1;
let env;
let seq = 0;
before(async () => {
  d1 = await criarD1DeTeste();
  env = { DB: d1.db };
});
after(async () => {
  await d1.dispose();
});
beforeEach(async () => {
  await d1.limpar();
  await d1.db.prepare('DELETE FROM bugs').run();
});

const novoId = () => `${snowflakeNow()}${String(++seq).padStart(3, '0')}`;

function slash(name, sub, values = {}, userId = OWNER) {
  const base = commandInteraction(name, userId);
  const options = Object.entries(values).map(([n, value]) => ({ name: n, value, type: typeof value === 'number' ? 4 : typeof value === 'boolean' ? 5 : 3 }));
  return { ...base, id: novoId(), data: { ...base.data, options: [{ name: sub, type: 1, options }] } };
}

/** Envio de formulário igual ao do Discord (componentes Label → Text Input). */
function modalSubmit(customId, values, userId = OWNER, id = novoId()) {
  const base = commandInteraction('x', userId);
  return {
    ...base,
    id,
    type: 5,
    data: {
      custom_id: customId,
      components: Object.entries(values).map(([custom_id, value], i) => ({ type: 18, id: i * 2 + 1, component: { type: 4, id: i * 2 + 2, custom_id, value } })),
    },
  };
}

async function rodar(command, interaction) {
  const res = await runCommand(command, interaction, { config, env });
  return res.json();
}
async function enviarModal(interaction) {
  const res = await handleInteraction(interaction, { config, env, meta: {} });
  return res.json();
}

describe('Formulários (modais)', () => {
  test('custom_id: formato "comando:acao[:id]"', () => {
    assert.deepEqual(parseModalCustomId('tarefa:descrever:12'), { command: 'tarefa', action: 'descrever', id: 12 });
    assert.deepEqual(parseModalCustomId('bug:registrar'), { command: 'bug', action: 'registrar', id: null });
    for (const ruim of ['', 'bug', 'bug:registrar:abc', 'Bug:x', '../x:y', null]) assert.equal(parseModalCustomId(ruim), null);
  });

  test('lê valores no formato atual (Label) e no antigo (Action Row)', () => {
    assert.deepEqual(readModalValues(modalSubmit('bug:registrar', { titulo: 'A', sistema: 'Horus' })), { titulo: 'A', sistema: 'Horus' });
    const antigo = { data: { components: [{ type: 1, components: [{ type: 4, custom_id: 'descricao', value: 'oi' }] }] } };
    assert.deepEqual(readModalValues(antigo), { descricao: 'oi' });
  });

  test('formulário desconhecido ou de comando sem formulário → recusado', async () => {
    assert.match((await enviarModal(modalSubmit('ping:x', {}))).data.content, /não reconhecido/);
    assert.match((await enviarModal(modalSubmit('nada', {}))).data.content, /não reconhecido/);
  });

  test('quem não é o proprietário não consegue enviar formulário', async () => {
    const res = await enviarModal(modalSubmit('bug:registrar', { titulo: 'x', sistema: 'y', descricao: 'z' }, STRANGER));
    assert.match(res.data.content, /restrito ao proprietário/);
    assert.equal((await d1.db.prepare('SELECT COUNT(*) AS n FROM bugs').first()).n, 0);
  });
});

describe('/bug', () => {
  test('registrar abre um formulário com 4 campos (título e sistema pré-preenchidos)', async () => {
    const res = await rodar(bugCommand, slash('bug', 'registrar', { sistema: 'Horus' }));
    assert.equal(res.type, 9);
    assert.equal(res.data.custom_id, 'bug:registrar');
    assert.equal(res.data.components.length, 4);
    for (const c of res.data.components) {
      assert.equal(c.type, 18);
      assert.ok(c.label.length <= 45);
    }
    assert.equal(res.data.components[1].component.value, 'Horus');
  });

  test('ciclo completo: registrar → resolver com a descrição do PR → ver → buscar', async () => {
    const registro = await enviarModal(
      modalSubmit('bug:registrar', {
        titulo: 'Impressão do apartamento em 1 coluna',
        sistema: 'Horus',
        descricao: 'A impressão sai numa coluna só e o logo some.',
        como_reproduzir: '1. Abrir um apartamento\n2. Clicar em imprimir',
      }),
    );
    assert.match(registro.data.content, /🐛 Bug registrado: 🐛 \*\*#(\d+)\*\* · Horus · Impressão do apartamento em 1 coluna/);
    const id = Number(registro.data.content.match(/#(\d+)/)[1]);

    const form = await rodar(bugCommand, slash('bug', 'resolver', { id }));
    assert.equal(form.data.custom_id, `bug:resolver:${id}`);

    const resolvido = await enviarModal(
      modalSubmit(`bug:resolver:${id}`, { causa: 'Classes col-xs-* do Bootstrap 3', solucao: PR_879, referencia: 'PR 879' }),
    );
    assert.match(resolvido.data.content, /✅ Resolução documentada: ✅ \*\*#\d+\*\*/);

    const ver = await rodar(bugCommand, slash('bug', 'ver', { id }));
    const [problema, resolucao] = ver.data.embeds;
    assert.match(problema.description, /\*\*Problema\*\*\nA impressão sai numa coluna só/);
    assert.match(problema.description, /\*\*Como reproduzir\*\*\n1\. Abrir um apartamento\n2\. Clicar em imprimir/);
    assert.equal(resolucao.title, '✅ Como foi resolvido');
    assert.ok(resolucao.description.includes(PR_879), 'a descrição do PR é guardada exatamente, com quebras de linha');
    assert.deepEqual(resolucao.fields, [{ name: 'Referência (PR / link)', value: 'PR 879' }]);
    assert.equal(ver.data.flags, 64);

    const busca = await rodar(bugCommand, slash('bug', 'buscar', { termo: 'col-xs' }));
    assert.match(busca.data.content, new RegExp(`#${id}\\*\\* · Horus`));
  });

  test('o mesmo envio de formulário duas vezes registra UM bug', async () => {
    const envio = modalSubmit('bug:registrar', { titulo: 'X', sistema: 'Horus', descricao: 'Y' });
    await enviarModal(envio);
    const segunda = await enviarModal(envio);
    assert.match(segunda.data.content, /já tinha sido registrado/);
    assert.equal((await d1.db.prepare('SELECT COUNT(*) AS n FROM bugs').first()).n, 1);
  });

  test('listar: abertos por padrão, filtro de status e sistema (sem diferenciar maiúsculas)', async () => {
    await enviarModal(modalSubmit('bug:registrar', { titulo: 'Bug Horus', sistema: 'Horus', descricao: 'a' }));
    await enviarModal(modalSubmit('bug:registrar', { titulo: 'Bug Prova', sistema: 'Prova-On', descricao: 'b' }));
    const { id } = await d1.db.prepare("SELECT id FROM bugs WHERE sistema = 'Prova-On'").first();
    await enviarModal(modalSubmit(`bug:resolver:${id}`, { solucao: 'ok' }));

    const abertos = (await rodar(bugCommand, slash('bug', 'listar'))).data.content;
    assert.match(abertos, /Bug Horus/);
    assert.doesNotMatch(abertos, /Bug Prova/);
    assert.match((await rodar(bugCommand, slash('bug', 'listar', { status: 'resolvidos' }))).data.content, /Bug Prova/);
    assert.match((await rodar(bugCommand, slash('bug', 'listar', { status: 'todos', sistema: 'horus' }))).data.content, /Bug Horus/);
  });

  test('reabrir volta para aberto e mantém a documentação', async () => {
    await enviarModal(modalSubmit('bug:registrar', { titulo: 'Volta', sistema: 'Horus', descricao: 'a' }));
    const { id } = await d1.db.prepare('SELECT id FROM bugs').first();
    await enviarModal(modalSubmit(`bug:resolver:${id}`, { solucao: 'corrigido' }));
    assert.match((await rodar(bugCommand, slash('bug', 'reabrir', { id }))).data.content, /🔁 Reaberto: 🐛/);
    const linha = await d1.db.prepare('SELECT status, solucao FROM bugs WHERE id = ?').bind(id).first();
    assert.deepEqual(linha, { status: 'aberto', solucao: 'corrigido' });
  });

  test('validações: problema e solução são obrigatórios; busca com % é literal', async () => {
    assert.match((await enviarModal(modalSubmit('bug:registrar', { titulo: 'x', sistema: 'y', descricao: '   ' }))).data.content, /Descreva o problema/);
    await enviarModal(modalSubmit('bug:registrar', { titulo: 'x', sistema: 'y', descricao: 'z' }));
    const { id } = await d1.db.prepare('SELECT id FROM bugs').first();
    assert.match((await enviarModal(modalSubmit(`bug:resolver:${id}`, { solucao: '' }))).data.content, /Descreva como o bug foi resolvido/);
    assert.match((await rodar(bugCommand, slash('bug', 'buscar', { termo: '%%' }))).data.content, /Nada encontrado/);
    assert.match((await rodar(bugCommand, slash('bug', 'ver', { id: 999 }))).data.content, /não encontrado/);
  });
});

describe('/tarefa com tipo e descrição longa', () => {
  test('criar com tipo e descrever:True abre o formulário da tarefa recém-criada', async () => {
    const res = await rodar(tarefaCommand, slash('tarefa', 'criar', { titulo: 'Revisar PR 879', tipo: 'melhoria', contexto: 'profissional', descrever: true }));
    assert.equal(res.type, 9);
    assert.match(res.data.custom_id, /^tarefa:descrever:\d+$/);
    const tarefa = await d1.db.prepare('SELECT tipo, contexto FROM tarefas').first();
    assert.deepEqual(tarefa, { tipo: 'melhoria', contexto: 'profissional' });
  });

  test('descrição de várias linhas é salva como digitada e aparece no /tarefa ver', async () => {
    await rodar(tarefaCommand, slash('tarefa', 'criar', { titulo: 'Revisar PR 879', tipo: 'melhoria' }));
    const { id } = await d1.db.prepare('SELECT id FROM tarefas').first();

    const salvo = await enviarModal(modalSubmit(`tarefa:descrever:${id}`, { descricao: `${PR_879}   \r\n` }));
    assert.match(salvo.data.content, /📄 Descrição salva: ⬜ \*\*#\d+\*\* · ✨ melhoria · pessoal · Revisar PR 879 · 📄/);

    const ver = await rodar(tarefaCommand, slash('tarefa', 'ver', { id }));
    assert.equal(ver.data.embeds[0].description, PR_879);
    assert.deepEqual(ver.data.embeds[0].fields[0], { name: 'Tipo', value: '✨ melhoria' });

    // Reabrir o formulário traz a descrição atual para editar.
    const form = await rodar(tarefaCommand, slash('tarefa', 'descrever', { id }));
    assert.equal(form.data.components[0].component.value, PR_879);

    // Enviar vazio apaga a descrição.
    assert.match((await enviarModal(modalSubmit(`tarefa:descrever:${id}`, { descricao: '' }))).data.content, /Descrição apagada/);
  });

  test('tipo inválido e descrição grande demais são recusados', async () => {
    assert.match((await rodar(tarefaCommand, slash('tarefa', 'criar', { titulo: 'x', tipo: 'bug' }))).data.content, /Tipo deve ser/);
    await rodar(tarefaCommand, slash('tarefa', 'criar', { titulo: 'x' }));
    const { id } = await d1.db.prepare('SELECT id FROM tarefas').first();
    assert.match((await enviarModal(modalSubmit(`tarefa:descrever:${id}`, { descricao: 'a'.repeat(4001) }))).data.content, /no máximo 4000/);
    assert.match((await enviarModal(modalSubmit('tarefa:descrever:9999', { descricao: 'a' }))).data.content, /não encontrada/);
  });

  test('tarefas antigas (sem tipo) continuam aparecendo como antes', async () => {
    await rodar(tarefaCommand, slash('tarefa', 'criar', { titulo: 'Estudar SQL' }));
    const lista = (await rodar(tarefaCommand, slash('tarefa', 'listar'))).data.content;
    assert.match(lista, /⬜ \*\*#\d+\*\* · pessoal · Estudar SQL$/m);
  });
});
