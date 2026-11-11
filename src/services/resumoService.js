// Monta os TEXTOS do relatório diário, do /painel e dos lembretes.
// Funções puras (sem banco, sem rede): fáceis de testar.

import { obterResumo } from '../database/estatisticasRepository.js';
import { endOfLocalDay, startOfLocalWeek, formatDateTime, formatShort, formatRelative } from './dateTime.js';
import { formatarTarefa, escapeMarkdown, juntarComLimite } from './tarefaFormat.js';

/** Busca os números já calculando "hoje" e "esta semana" no fuso de Brasília. */
export function carregarResumo(db, agora = Date.now()) {
  return obterResumo(db, {
    agora,
    fimDoDia: endOfLocalDay(agora),
    inicioDaSemana: startOfLocalWeek(agora),
  });
}

function taxa(parte, total) {
  return total > 0 ? `${Math.round((parte / total) * 100)}%` : '—';
}

function linhaProdutividade(semana) {
  const { criadas, concluidas, concluidasComPrazo, concluidasNoPrazo } = semana;
  const noPrazo = concluidasComPrazo > 0 ? ` · no prazo: ${concluidasNoPrazo}/${concluidasComPrazo} (${taxa(concluidasNoPrazo, concluidasComPrazo)})` : '';
  return `📈 Semana: ${criadas} criada(s) · ${concluidas} concluída(s)${noPrazo}`;
}

function secao(titulo, tarefas, agora, vazio) {
  if (tarefas.length === 0) return vazio ? [titulo, vazio] : [];
  return [titulo, ...tarefas.map((t) => `• ${formatarTarefa(t, agora)}`)];
}

/** Relatório das 08:00, enviado ao #kaiky. */
export function montarRelatorioDiario(r, agora) {
  const cabecalho = `☀️ **Bom dia! Relatório de ${formatDateTime(agora).slice(0, 10)}**`;
  if (r.pendentes === 0) {
    return [cabecalho, '✅ **Tudo em dia!** Nenhuma tarefa pendente.', linhaProdutividade(r.semana)].join('\n');
  }

  const linhas = [
    `📋 Pendentes: **${r.pendentes}** (pessoal ${r.pendentesPorContexto.pessoal} · profissional ${r.pendentesPorContexto.profissional} · sem prazo ${r.pendentesSemPrazo})`,
    ...secao(`⚠️ **Atrasadas (${r.totalAtrasadas})**`, r.atrasadas, agora),
    ...secao(`📅 **Vencem hoje (${r.vencemHoje.length})**`, r.vencemHoje, agora),
    linhaProdutividade(r.semana),
  ];
  if (r.totalAtrasadas === 0 && r.vencemHoje.length === 0) linhas.splice(1, 0, '👍 Nada atrasado e nada vencendo hoje.');
  return juntarComLimite(cabecalho, linhas);
}

/** /painel: visão geral, só para você. */
export function montarPainel(r, agora) {
  const linhas = [
    `📋 Pendentes: **${r.pendentes}** (pessoal ${r.pendentesPorContexto.pessoal} · profissional ${r.pendentesPorContexto.profissional})`,
    `⚠️ Atrasadas: **${r.totalAtrasadas}**`,
    `✅ Concluídas na semana: **${r.semana.concluidas}**`,
    linhaProdutividade(r.semana),
    ...secao('⏳ **Próximos vencimentos**', r.proximos, agora, 'Nenhuma tarefa com prazo pela frente.'),
    ...secao('⚠️ **Atrasadas**', r.atrasadas.slice(0, 5), agora),
  ];
  return juntarComLimite('📊 **Painel do Kaiky Assistant**', linhas);
}

/**
 * Mensagem fixa do #dashboard: tarefas pendentes e bugs abertos.
 * Cada parte tem seu próprio "orçamento" de caracteres para caber nos 2000.
 */
export function montarDashboard({ tarefas, totalTarefas, atrasadas, bugs, totalBugs }, agora) {
  const cabecalho = `📌 **Pendências** · atualizado em ${formatShort(agora)} (a cada 5 min)`;

  const tituloTarefas = `\n📋 **Tarefas pendentes: ${totalTarefas}**${atrasadas ? ` · ⚠️ ${atrasadas} atrasada(s)` : ''}`;
  const parteTarefas = tarefas.length
    ? juntarComLimite(tituloTarefas, tarefas.map((t) => `• ${formatarTarefa(t, agora)}`).concat(totalTarefas > tarefas.length ? [`… e mais ${totalTarefas - tarefas.length}.`] : []), 1150)
    : `${tituloTarefas}\n✅ Nenhuma tarefa pendente.`;

  const tituloBugs = `\n🐛 **Bugs abertos: ${totalBugs}**`;
  const parteBugs = bugs.length
    ? juntarComLimite(tituloBugs, bugs.map((b) => `• **#${b.id}** · ${escapeMarkdown(b.sistema)} · ${escapeMarkdown(b.titulo)}`).concat(totalBugs > bugs.length ? [`… e mais ${totalBugs - bugs.length}.`] : []), 600)
    : `${tituloBugs}\n✅ Nenhum bug aberto.`;

  return [cabecalho, parteTarefas, parteBugs].join('\n');
}

/** Uma mensagem com os lembretes de uma execução do Cron. */
export function montarLembretes(tarefas, agora) {
  const linhas = tarefas.map((t) => {
    const quando = t.prazo < agora ? `venceu ${formatRelative(t.prazo, agora)}` : `vence ${formatRelative(t.prazo, agora)}`;
    return `• **#${t.id}** · ${escapeMarkdown(t.titulo)} · 📅 ${formatShort(t.prazo)} (${quando})`;
  });
  return juntarComLimite(`⏰ **Lembrete${tarefas.length > 1 ? 's' : ''}**`, [
    ...linhas,
    'Use `/tarefa concluir id:<número>` quando terminar.',
  ]);
}
