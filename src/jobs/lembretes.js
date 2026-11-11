// Job: lembretes de prazo (roda a cada 5 minutos).
//
// Regras:
//  - só tarefas PENDENTES com prazo;
//  - o lembrete sai quando falta até 1 hora (ou se já venceu);
//  - cada tarefa recebe NO MÁXIMO um lembrete (chave 'lembrete:<id>' no D1);
//  - vários lembretes da mesma execução vão juntos numa única mensagem.

import * as notificacoes from '../database/notificacoesRepository.js';
import { sendWebhookMessage } from '../discord/webhook.js';
import { montarLembretes } from '../services/resumoService.js';
import { logger } from '../services/logger.js';

export const ANTECEDENCIA_MS = 60 * 60 * 1000; // 1 hora

/** @returns {Promise<{ enviados: number, status: string }>} */
export async function enviarLembretes(env, agora) {
  const candidatas = await notificacoes.tarefasParaLembrar(env.DB, { limite: agora + ANTECEDENCIA_MS });
  if (candidatas.length === 0) return { enviados: 0, status: 'nada_a_enviar' };

  // 1) Reserva cada lembrete. Se outra execução já reservou, pulamos a tarefa.
  const reservadas = [];
  for (const tarefa of candidatas) {
    const chave = notificacoes.chaveLembrete(tarefa.id);
    if (await notificacoes.reservar(env.DB, { chave, tipo: 'lembrete', tarefaId: tarefa.id, agora })) {
      reservadas.push({ tarefa, chave });
    }
  }
  if (reservadas.length === 0) return { enviados: 0, status: 'ja_reservados' };
  const chaves = reservadas.map((r) => r.chave);

  // 2) Envia uma única mensagem com todos os lembretes reservados.
  let resultado;
  try {
    resultado = await sendWebhookMessage(env.DISCORD_WEBHOOK_URL, montarLembretes(reservadas.map((r) => r.tarefa), agora));
  } catch (error) {
    resultado = { ok: false, status: 0, error };
  }

  // 3) Confirma ou libera (para tentar de novo no próximo Cron).
  if (resultado.ok) {
    await notificacoes.confirmar(env.DB, chaves, agora);
    return { enviados: reservadas.length, status: 'enviado' };
  }
  await notificacoes.liberar(env.DB, chaves);
  logger.error('notification_failed', { reason: 'lembrete', http_status: resultado.status, error_name: resultado.error?.name });
  return { enviados: 0, status: 'falhou' };
}
