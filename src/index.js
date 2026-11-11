// Ponto de entrada do Worker.
//
// A Cloudflare chama `fetch` a cada requisição HTTP que chega no endereço
// workers.dev. Não existe processo rodando o tempo todo (nada de
// client.login()): o Worker "acorda", responde e termina.
//
// Fluxo de uma interação:
//   Discord → POST / → valida assinatura → interpreta JSON → handler → resposta

import { getConfig, ConfigError } from './config/env.js';
import { verifyDiscordRequest } from './discord/verifySignature.js';
import { handleInteraction } from './events/interactionHandler.js';
import { json, text } from './discord/responses.js';

const MAX_BODY_BYTES = 64 * 1024; // interações reais têm poucos KB

export default {
  /**
   * @param {Request} request
   * @param {Record<string, unknown>} env Variáveis e segredos
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
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
      if (error instanceof ConfigError) {
        console.error('Configuração inválida:', error.message);
        return text('Servidor não configurado.', 500);
      }
      throw error;
    }

    const contentLength = Number(request.headers.get('Content-Length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return text('Requisição muito grande.', 413);

    // 1) Segurança primeiro: nada é processado antes de validar a assinatura.
    const { isValid, body } = await verifyDiscordRequest(request, config.publicKey);
    if (!isValid) return text('Assinatura inválida.', 401);

    // 2) Só agora interpretamos o JSON.
    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return json({ error: 'JSON inválido.' }, 400);
    }

    // 3) Encaminha para o roteador de interações.
    try {
      return await handleInteraction(interaction, { config, env, ctx });
    } catch (error) {
      console.error('Erro inesperado:', error?.stack ?? error);
      return json({ error: 'Erro interno.' }, 500);
    }
  },
};
