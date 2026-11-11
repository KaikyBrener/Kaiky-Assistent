// Números das tarefas usados pelo relatório diário (Cron) e pelo /painel.
// Todas as consultas vão juntas num único batch (uma ida ao banco).

import { COLUNAS, paraTarefa } from './tarefasRepository.js';

/**
 * @param {D1Database} db
 * @param {{ agora: number, fimDoDia: number, inicioDaSemana: number }} periodo
 *        instantes UTC (ms) já calculados no fuso de Brasília
 */
export async function obterResumo(db, { agora, fimDoDia, inicioDaSemana }) {
  const [porContexto, atrasadas, totalAtrasadas, vencemHoje, proximos, semana, semPrazo] = await db.batch([
    db.prepare(`SELECT contexto, COUNT(*) AS total FROM tarefas WHERE concluida = 0 GROUP BY contexto`),
    db
      .prepare(
        `SELECT ${COLUNAS} FROM tarefas
         WHERE concluida = 0 AND prazo IS NOT NULL AND prazo < ?
         ORDER BY prazo ASC LIMIT 10`,
      )
      .bind(agora),
    db
      .prepare(`SELECT COUNT(*) AS total FROM tarefas WHERE concluida = 0 AND prazo IS NOT NULL AND prazo < ?`)
      .bind(agora),
    db
      .prepare(
        `SELECT ${COLUNAS} FROM tarefas
         WHERE concluida = 0 AND prazo >= ? AND prazo < ?
         ORDER BY prazo ASC LIMIT 10`,
      )
      .bind(agora, fimDoDia),
    db
      .prepare(
        `SELECT ${COLUNAS} FROM tarefas
         WHERE concluida = 0 AND prazo >= ?
         ORDER BY prazo ASC LIMIT 5`,
      )
      .bind(agora),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN criada_em >= ?1 THEN 1 ELSE 0 END) AS criadas,
           SUM(CASE WHEN concluida = 1 AND concluida_em >= ?1 THEN 1 ELSE 0 END) AS concluidas,
           SUM(CASE WHEN concluida = 1 AND concluida_em >= ?1 AND prazo IS NOT NULL THEN 1 ELSE 0 END) AS concluidas_com_prazo,
           SUM(CASE WHEN concluida = 1 AND concluida_em >= ?1 AND prazo IS NOT NULL AND concluida_em <= prazo THEN 1 ELSE 0 END) AS concluidas_no_prazo
         FROM tarefas`,
      )
      .bind(inicioDaSemana),
    db.prepare(`SELECT COUNT(*) AS total FROM tarefas WHERE concluida = 0 AND prazo IS NULL`),
  ]);

  const pendentesPorContexto = { pessoal: 0, profissional: 0 };
  for (const linha of porContexto.results) pendentesPorContexto[linha.contexto] = linha.total;
  const s = semana.results[0] ?? {};

  return {
    pendentes: pendentesPorContexto.pessoal + pendentesPorContexto.profissional,
    pendentesPorContexto,
    pendentesSemPrazo: semPrazo.results[0].total,
    atrasadas: atrasadas.results.map(paraTarefa),
    totalAtrasadas: totalAtrasadas.results[0].total,
    vencemHoje: vencemHoje.results.map(paraTarefa),
    proximos: proximos.results.map(paraTarefa),
    semana: {
      criadas: s.criadas ?? 0,
      concluidas: s.concluidas ?? 0,
      concluidasComPrazo: s.concluidas_com_prazo ?? 0,
      concluidasNoPrazo: s.concluidas_no_prazo ?? 0,
    },
  };
}
