// Testes do /painel e do /ajuda (FASE 4). O painel usa um D1 local real.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarD1DeTeste } from './helpers/d1.js';
import { criarTarefa, concluirTarefa } from '../src/database/tarefasRepository.js';
import { carregarResumo, montarPainel } from '../src/services/resumoService.js';
import { montarAjuda } from '../src/commands/central/ajuda.js';
import ajuda from '../src/commands/central/ajuda.js';
import { commands } from '../src/commands/index.js';
import { fromLocal } from '../src/services/dateTime.js';

let d1;
let seq = 0;
before(async () => {
  d1 = await criarD1DeTeste();
});
after(async () => {
  await d1.dispose();
});
beforeEach(async () => {
  await d1.limpar();
});

const nova = (titulo, { prazo = null, agora, contexto = 'pessoal' }) =>
  criarTarefa(d1.db, { titulo, contexto, prazo, interactionId: `p${++seq}`, agora }).then((r) => r.tarefa);

describe('/painel', () => {
  test('pendentes, atrasadas, concluídas na semana, próximos vencimentos e produtividade', async () => {
    const segunda = fromLocal(2026, 11, 16, 9, 0);
    const agora = fromLocal(2026, 11, 18, 10, 0); // quarta
    const semanaPassada = fromLocal(2026, 11, 10, 9, 0);

    const noPrazo = await nova('Entregar relatório', { prazo: fromLocal(2026, 11, 17, 18, 0), agora: segunda, contexto: 'profissional' });
    await concluirTarefa(d1.db, { id: noPrazo.id, agora: fromLocal(2026, 11, 17, 12, 0) });
    const foraDoPrazo = await nova('Pagar boleto', { prazo: fromLocal(2026, 11, 16, 12, 0), agora: segunda });
    await concluirTarefa(d1.db, { id: foraDoPrazo.id, agora: fromLocal(2026, 11, 16, 15, 0) });
    const antiga = await nova('Concluída semana passada', { agora: semanaPassada });
    await concluirTarefa(d1.db, { id: antiga.id, agora: semanaPassada });

    await nova('Atrasada', { prazo: fromLocal(2026, 11, 17, 9, 0), agora: segunda });
    await nova('Amanhã', { prazo: fromLocal(2026, 11, 19, 14, 0), agora: segunda, contexto: 'profissional' });
    await nova('Sem prazo', { agora: segunda });

    const texto = montarPainel(await carregarResumo(d1.db, agora), agora);
    assert.match(texto, /Pendentes: \*\*3\*\* \(pessoal 2 · profissional 1\)/);
    assert.match(texto, /Atrasadas: \*\*1\*\*/);
    assert.match(texto, /Concluídas na semana: \*\*2\*\*/);
    assert.match(texto, /Semana: 5 criada\(s\) · 2 concluída\(s\) · no prazo: 1\/2 \(50%\)/);
    assert.match(texto, /Próximos vencimentos\*\*\n• ⬜ \*\*#\d+\*\* · profissional · Amanhã · 📅 19\/11 14:00/);
    assert.match(texto, /Atrasadas\*\*\n• ⬜ \*\*#\d+\*\* · pessoal · Atrasada · 📅 17\/11 09:00 · ⚠️ atrasada/);
    assert.doesNotMatch(texto, /Concluída semana passada/);
  });

  test('banco vazio', async () => {
    const agora = Date.now();
    const texto = montarPainel(await carregarResumo(d1.db, agora), agora);
    assert.match(texto, /Pendentes: \*\*0\*\*/);
    assert.match(texto, /Nenhuma tarefa com prazo pela frente/);
  });
});

describe('/ajuda', () => {
  test('lista todos os comandos e subcomandos, marcando os restritos', () => {
    const texto = montarAjuda(commands);
    for (const nome of ['ping', 'ajuda', 'painel', 'tarefa', 'github']) assert.match(texto, new RegExp(`\`/${nome}\``));
    assert.match(texto, /`\/painel` 🔒/);
    assert.match(texto, /`\/ping` —/);
    assert.match(texto, /◦ `criar` —/);
    assert.match(texto, /◦ `atividade` —/);
  });

  test('é pública, efêmera e funciona (import dinâmico sem ciclo)', async () => {
    assert.equal(ajuda.ownerOnly, false);
    const data = (await (await ajuda.execute()).json()).data;
    assert.equal(data.flags, 64);
    assert.match(data.content, /Comandos do Kaiky Assistant/);
  });
});
