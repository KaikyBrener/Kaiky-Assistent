// Ponto de entrada do Worker.
//
// A Cloudflare chama `fetch` a cada requisição HTTP que chega no endereço
// workers.dev. Não existe processo rodando o tempo todo (nada de
// client.login()): o Worker "acorda", responde e termina.
//
// Fluxo de uma interação:
//   Discord → POST / → lê corpo (máx. 64 KB) → valida assinatura → JSON → handler → resposta
//
// A cada 5 minutos o Cron chama `scheduled` (lembretes e relatório diário).

import { getConfig, ConfigError } from './config/env.js';
import { verifyDiscordSignature } from './discord/verifySignature.js';
import { readBodyWithLimit, BodyTooLargeError } from './discord/readBody.js';
import { handleInteraction } from './events/interactionHandler.js';
import { json, text } from './discord/responses.js';
import { logger, errorFields } from './services/logger.js';
import { runScheduledJobs } from './jobs/index.js';

const MAX_BODY_BYTES = 64 * 1024; // interações reais têm poucos KB

export default {
  /**
   * @param {Request} request
   * @param {Record<string, unknown>} env Variáveis e segredos
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    // Rede de segurança: qualquer erro não previsto vira um 500 limpo e um log.
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      logger.error('unhandled_error', errorFields(error));
      return json({ error: 'Erro interno.' }, 500);
    }
  },

  /**
   * Chamado pelo Cron Trigger (wrangler.jsonc → triggers.crons), em UTC.
   * @param {ScheduledController} controller `scheduledTime` = horário previsto (ms)
   */
  async scheduled(controller, env, ctx) {
    try {
      await runScheduledJobs(env, controller.scheduledTime);
    } catch (error) {
      logger.error('unhandled_error', errorFields(error));
    }
  },
};

async function handleRequest(request, env, ctx) {
  const { pathname } = new URL(request.url);

  if (pathname !== '/') return text('Não encontrado.', 404);

  // GET / → checagem rápida no navegador de que o Worker está no ar.
  if (request.method === 'GET') {
    return text(`${env.APP_NAME ?? 'Kaiky Assistant'} está online. 🤖`);
  }

  if (request.method !== 'POST') {
    return new Response('Método não permitido.', { status: 405, headers: { Allow: 'GET, POST' } });
  }

  let config;
  try {
    config = getConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    logger.error('config_invalid', { error_message: error.message });
    return text('Servidor não configurado.', 500);
  }

  // 1) Lê o corpo com limite real de tamanho (mesmo sem Content-Length).
  let bodyBytes;
  try {
    bodyBytes = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (!(error instanceof BodyTooLargeError)) throw error;
    logger.warn('request_rejected', { reason: 'body_too_large', http_status: 413 });
    return text('Requisição muito grande.', 413);
  }

  // 2) Segurança primeiro: nada é interpretado antes de validar a assinatura.
  const isValid = await verifyDiscordSignature(request.headers, bodyBytes, config.publicKey);
  if (!isValid) {
    logger.warn('request_rejected', { reason: 'invalid_signature', http_status: 401 });
    return text('Assinatura inválida.', 401);
  }

  // 3) Só agora transformamos os bytes em texto e depois em JSON.
  let interaction;
  try {
    interaction = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    logger.warn('request_rejected', { reason: 'invalid_json', http_status: 400 });
    return json({ error: 'JSON inválido.' }, 400);
  }

  // 4) Encaminha para o roteador. `meta` coleta o resultado para o log final.
  const meta = { outcome: 'ok' };
  const response = await handleInteraction(interaction, { config, env, ctx, meta });

  // Um log de resumo por interação (sem token e sem dados do usuário).
  logger.info('interaction', {
    interaction_id: typeof interaction?.id === 'string' ? interaction.id : undefined,
    interaction_type: interaction?.type,
    command: typeof interaction?.data?.name === 'string' ? interaction.data.name : undefined,
    outcome: meta.outcome,
    reason: meta.reason,
    deferred: meta.deferred,
    http_status: response.status,
  });
  return response;
}
