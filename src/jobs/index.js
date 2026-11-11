// Ponto de entrada das rotinas do Cron (chamado pelo `scheduled` em src/index.js).
//
// Usamos UM Cron Trigger ("*/5 * * * *") porque o plano gratuito permite só
// 5 por conta. A cada execução, decidimos aqui o que rodar.

import { enviarLembretes } from './lembretes.js';
import { enviarRelatorioDiario } from './relatorioDiario.js';
import { atualizarDashboard } from './dashboard.js';
import { isValidWebhookUrl } from '../discord/webhook.js';
import { logger, errorFields } from '../services/logger.js';

/**
 * @param {Record<string, any>} env
 * @param {number} agora instante da execução (controller.scheduledTime)
 */
export async function runScheduledJobs(env, agora) {
  if (!env?.DB) {
    logger.error('config_invalid', { reason: 'd1_binding_missing' });
    return { lembretes: 'nao_configurado', relatorio: 'nao_configurado', dashboard: 'nao_configurado' };
  }

  // Lembretes e relatório usam o webhook do #kaiky. Sem ele, NADA é reservado.
  const kaikyOk = isValidWebhookUrl(env.DISCORD_WEBHOOK_URL);
  if (!kaikyOk) logger.error('config_invalid', { reason: 'webhook_url_invalid' });

  // Cada job é independente: a falha de um não impede os outros.
  const jobs = [
    ['lembretes', kaikyOk ? enviarLembretes : null],
    ['relatorio', kaikyOk ? enviarRelatorioDiario : null],
    ['dashboard', atualizarDashboard], // opcional: ele mesmo verifica o próprio webhook
  ];
  const resultado = {};
  for (const [nome, job] of jobs) {
    if (!job) {
      resultado[nome] = 'nao_configurado';
      continue;
    }
    try {
      resultado[nome] = (await job(env, agora)).status;
    } catch (error) {
      resultado[nome] = 'erro';
      logger.error('job_failed', { reason: nome, ...errorFields(error) });
    }
  }

  logger.info('scheduled', {
    outcome: `lembretes=${resultado.lembretes} relatorio=${resultado.relatorio} dashboard=${resultado.dashboard}`,
  });
  return resultado;
}
