// Job: relatório diário das 08:00 (horário de Brasília).
//
// O Cron roda a cada 5 minutos. A partir das 08:00, a PRIMEIRA execução do
// dia envia o relatório; a chave 'relatorio:<AAAA-MM-DD>' no D1 impede um
// segundo envio no mesmo dia (mesmo com reexecução do Cron).

import * as notificacoes from '../database/notificacoesRepository.js';
import { sendWebhookMessage } from '../discord/webhook.js';
import { carregarResumo, montarRelatorioDiario } from '../services/resumoService.js';
import { localParts, localDateKey } from '../services/dateTime.js';
import { logger } from '../services/logger.js';

export const HORA_DO_RELATORIO = 8;

/** @returns {Promise<{ status: string }>} */
export async function enviarRelatorioDiario(env, agora) {
  if (localParts(agora).hour < HORA_DO_RELATORIO) return { status: 'antes_do_horario' };

  const chave = notificacoes.chaveRelatorio(localDateKey(agora));
  if (!(await notificacoes.reservar(env.DB, { chave, tipo: 'relatorio', agora }))) {
    return { status: 'ja_enviado' };
  }

  let resultado;
  try {
    const texto = montarRelatorioDiario(await carregarResumo(env.DB, agora), agora);
    resultado = await sendWebhookMessage(env.DISCORD_WEBHOOK_URL, texto);
  } catch (error) {
    resultado = { ok: false, status: 0, error };
  }

  if (resultado.ok) {
    await notificacoes.confirmar(env.DB, [chave], agora);
    return { status: 'enviado' };
  }
  await notificacoes.liberar(env.DB, [chave]);
  logger.error('notification_failed', { reason: 'relatorio', http_status: resultado.status, error_name: resultado.error?.name });
  return { status: 'falhou' };
}
