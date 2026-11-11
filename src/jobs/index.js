// Ponto de entrada das rotinas do Cron (chamado pelo `scheduled` em src/index.js).
//
// Usamos UM Cron Trigger ("*/5 * * * *") porque o plano gratuito permite só
// 5 por conta. A cada execução, decidimos aqui o que rodar.

import { enviarLembretes } from './lembretes.js';
import { enviarRelatorioDiario } from './relatorioDiario.js';
import { isValidWebhookUrl } from '../discord/webhook.js';
import { logger, errorFields } from '../services/logger.js';

/**
 * @param {Record<string, any>} env
 * @param {number} agora instante da execução (controller.scheduledTime)
 */
export async function runScheduledJobs(env, agora) {
  if (!env?.DB || !isValidWebhookUrl(env?.DISCORD_WEBHOOK_URL)) {
    // Sem banco ou sem webhook válido não há o que fazer, e NADA é reservado.
    logger.error('config_invalid', { reason: !env?.DB ? 'd1_binding_missing' : 'webhook_url_invalid' });
    return { lembretes: 'nao_configurado', relatorio: 'nao_configurado' };
  }

  // Cada job é independente: a falha de um não impede o outro.
  const resultado = {};
  for (const [nome, job] of [
    ['lembretes', enviarLembretes],
    ['relatorio', enviarRelatorioDiario],
  ]) {
    try {
      resultado[nome] = (await job(env, agora)).status;
    } catch (error) {
      resultado[nome] = 'erro';
      logger.error('job_failed', { reason: nome, ...errorFields(error) });
    }
  }

  logger.info('scheduled', { outcome: `lembretes=${resultado.lembretes} relatorio=${resultado.relatorio}` });
  return resultado;
}
