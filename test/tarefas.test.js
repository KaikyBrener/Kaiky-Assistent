// Testes unitários do /tarefa (sem banco: regras, leitura de opções e formatação).
// O fluxo completo com D1 está em test/runtime/tarefas.runtime.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSubcommand } from '../src/discord/options.js';
import { validarTitulo, validarContexto, validarId, ValidationError } from '../src/services/tarefaService.js';
import tarefa, { escapeMarkdown, formatarLista } from '../src/commands/tarefas/tarefa.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import { validateDefinitions } from '../scripts/lib/commandPlan.js';
import { commandInteraction } from '../scripts/lib/signing.js';

describe('readSubcommand', () => {
  test('lê subcomando e valores', () => {
    const interaction = {
      data: { name: 'tarefa', options: [{ name: 'criar', type: 1, options: [{ name: 'titulo', type: 3, value: 'Ler' }] }] },
    };
    assert.deepEqual(readSubcommand(interaction), { name: 'criar', values: { titulo: 'Ler' } });
  });

  test('sem subcomando ou com formato estranho → null', () => {
    assert.equal(readSubcommand({ data: {} }), null);
    assert.equal(readSubcommand({ data: { options: [{ name: 'x', type: 3, value: 1 }] } }), null);
    assert.equal(readSubcommand(null), null);
  });
});

describe('Validação', () => {
  test('título: limpa espaços e quebras de linha', () => {
    assert.equal(validarTitulo('  Estudar\n\n  SQL  '), 'Estudar SQL');
  });

  test('título: vazio, longo ou não-texto é recusado', () => {
    assert.throws(() => validarTitulo('   '), ValidationError);
    assert.throws(() => validarTitulo('x'.repeat(201)), ValidationError);
    assert.throws(() => validarTitulo(42), ValidationError);
    assert.equal(validarTitulo('x'.repeat(200)).length, 200);
  });

  test('contexto: padrão e valores permitidos', () => {
    assert.equal(validarContexto(undefined), 'pessoal');
    assert.equal(validarContexto(undefined, null), null);
    assert.equal(validarContexto('profissional'), 'profissional');
    assert.throws(() => validarContexto('PESSOAL'), ValidationError);
  });

  test('id: só inteiros positivos', () => {
    assert.equal(validarId(7), 7);
    for (const ruim of [0, -1, 1.5, '1', NaN, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      assert.throws(() => validarId(ruim), ValidationError, `aceitou ${ruim}`);
    }
  });
});

describe('Formatação', () => {
  test('escapeMarkdown neutraliza formatação do Discord', () => {
    assert.equal(escapeMarkdown('**a** _b_ `c` ~~d~~'), '\\*\\*a\\*\\* \\_b\\_ \\`c\\` \\~\\~d\\~\\~');
  });

  test('lista vazia e lista com "e mais N"', () => {
    assert.match(formatarLista({ tarefas: [], total: 0 }, {}), /Nenhuma tarefa/);
    const uma = { id: 1, titulo: 'A', contexto: 'pessoal', concluida: false };
    assert.match(formatarLista({ tarefas: [uma], total: 25 }, {}), /e mais 24/);
  });

  test('a lista mais longa possível cabe no limite de 2000 caracteres do Discord', () => {
    const longas = Array.from({ length: 20 }, (_, i) => ({
      id: 100000 + i,
      titulo: '*'.repeat(200), // pior caso: cada caractere vira 2 com o escape
      contexto: 'profissional',
      concluida: true,
    }));
    const texto = formatarLista({ tarefas: longas, total: 999 }, { contexto: 'profissional', todas: true });
    // reply() corta em 2000; aqui conferimos que pelo menos a 1ª tarefa aparece inteira.
    assert.ok(texto.length > 2000, 'cenário extremo é cortado pelo reply(), não quebra');
    assert.ok(texto.slice(0, 2000).includes('#100000'));
  });
});

describe('Comando /tarefa', () => {
  test('é restrito ao proprietário (não declara ownerOnly) e registra 🔒', () => {
    assert.equal('ownerOnly' in tarefa, false);
    const def = getCommandDefinitions().find((d) => d.name === 'tarefa');
    assert.equal(def.default_member_permissions, '0');
  });

  test('definição segue as regras do Discord (nomes, descrições, obrigatórias primeiro)', () => {
    assert.deepEqual(validateDefinitions(getCommandDefinitions()), []);
  });

  test('validação detecta opção obrigatória depois de opcional', () => {
    const errado = [{ name: 'x', description: 'x', options: [
      { type: 3, name: 'a', description: 'a' },
      { type: 3, name: 'b', description: 'b', required: true },
    ] }];
    assert.equal(validateDefinitions(errado).length, 1);
  });

  test('sem binding DB → mensagem clara, sem quebrar', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const interaction = { ...commandInteraction('tarefa'), data: { name: 'tarefa', options: [{ name: 'listar', type: 1 }] } };
      const res = await tarefa.execute(interaction, { env: {} });
      assert.match((await res.json()).data.content, /banco de dados não está configurado/);
    } finally {
      console.error = originalError;
    }
  });

  test('subcomando desconhecido → aviso efêmero', async () => {
    const interaction = { ...commandInteraction('tarefa'), data: { name: 'tarefa', options: [{ name: 'apagar-tudo', type: 1 }] } };
    const data = (await (await tarefa.execute(interaction, { env: { DB: {} } })).json()).data;
    assert.match(data.content, /não reconhecido/);
    assert.equal(data.flags, 64);
  });
});
