// Anti-duplicidade das notificações do Cron (lembretes e relatório diário).
//
// O padrão é "reservar → enviar → confirmar":
//   1. reservar(): INSERT com chave única. Só UMA execução do Cron consegue.
//   2. enviar a mensagem pelo webhook.
//   3. deu certo → confirmar(); deu errado → liberar() (a próxima execução tenta de novo).
//
// Assim, mesmo que o Cron rode duas vezes ao mesmo tempo ou seja reexecutado,
// a mesma notificação não sai duas vezes.

import { COLUNAS, paraTarefa } from './tarefasRepository.js';

/** @returns {Promise<boolean>} true se ESTA execução ficou com a chave. */
export async function reservar(db, { chave, tipo, tarefaId = null, agora }) {
  const linha = await db
    .prepare(
      `INSERT INTO notificacoes (chave, tipo, tarefa_id, status, criada_em)
       VALUES (?, ?, ?, 'enviando', ?)
       ON CONFLICT (chave) DO NOTHING
       RETURNING chave`,
    )
    .bind(chave, tipo, tarefaId, agora)
    .first();
  return linha !== null;
}

export async function confirmar(db, chaves, agora) {
  if (chaves.length === 0) return;
  await db.batch(
    chaves.map((chave) =>
      db.prepare(`UPDATE notificacoes SET status = 'enviada', enviada_em = ? WHERE chave = ?`).bind(agora, chave),
    ),
  );
}

/** Desfaz a reserva depois de uma falha, para tentar de novo no próximo Cron. */
export async function liberar(db, chaves) {
  if (chaves.length === 0) return;
  await db.batch(
    chaves.map((chave) => db.prepare(`DELETE FROM notificacoes WHERE chave = ? AND status = 'enviando'`).bind(chave)),
  );
}

export const chaveLembrete = (tarefaId) => `lembrete:${tarefaId}`;
export const chaveRelatorio = (dataLocal) => `relatorio:${dataLocal}`;

/**
 * Tarefas pendentes cujo prazo vence até `limite` (inclui as já vencidas)
 * e que ainda NÃO tiveram lembrete.
 */
export async function tarefasParaLembrar(db, { limite, maximo = 10 }) {
  const { results } = await db
    .prepare(
      `SELECT ${COLUNAS} FROM tarefas t
       WHERE t.concluida = 0
         AND t.prazo IS NOT NULL
         AND t.prazo <= ?
         AND NOT EXISTS (SELECT 1 FROM notificacoes n WHERE n.chave = 'lembrete:' || t.id)
       ORDER BY t.prazo ASC
       LIMIT ?`,
    )
    .bind(limite, maximo)
    .all();
  return results.map(paraTarefa);
}
