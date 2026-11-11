// Envia mensagens para o canal #kaiky através de um WEBHOOK do Discord.
//
// Por que webhook e não o bot? Um webhook só consegue postar em UM canal.
// Mesmo que vazasse, o estrago seria limitado. O token do bot (que tem mais
// poderes) continua fora do Worker.
//
// A URL do webhook contém um token: ela é um SEGREDO (DISCORD_WEBHOOK_URL)
// e nunca é registrada em log.
// Docs: Execute Webhook — POST /webhooks/{id}/{token}?wait=true

import { messageData } from './responses.js';
import { retryDelayMs } from './followup.js';

// Formato esperado: https://discord.com/api/webhooks/<id>/<token>
const WEBHOOK_URL = /^https:\/\/(?:discord\.com|discordapp\.com)\/api(?:\/v\d+)?\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{20,200}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isValidWebhookUrl(url) {
  return typeof url === 'string' && WEBHOOK_URL.test(url.trim());
}

/**
 * @param {string} webhookUrl
 * @param {string} content texto da mensagem (cortado em 2000 caracteres)
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ ok: boolean, status: number, messageId?: string }>}
 *          `messageId` = ID da mensagem criada (usado pelo #dashboard para editá-la depois)
 */
export async function sendWebhookMessage(webhookUrl, content, { fetchImpl = fetch } = {}) {
  if (!isValidWebhookUrl(webhookUrl)) return { ok: false, status: 0 };
  // wait=true: o Discord só responde depois de criar a mensagem, então
  // sabemos com certeza se ela foi enviada (sem isso, falhas passam caladas).
  return webhookRequest(`${webhookUrl.trim()}?wait=true`, 'POST', content, fetchImpl);
}

/**
 * Edita uma mensagem que ESTE webhook enviou antes (o #dashboard usa isso
 * para atualizar sempre a mesma mensagem em vez de criar uma nova).
 * Endpoint: PATCH /webhooks/{id}/{token}/messages/{message_id}
 * Status 404 = a mensagem foi apagada (ou é de outro webhook).
 */
export async function editWebhookMessage(webhookUrl, messageId, content, { fetchImpl = fetch } = {}) {
  if (!isValidWebhookUrl(webhookUrl) || !/^\d{17,20}$/.test(String(messageId))) return { ok: false, status: 0 };
  return webhookRequest(`${webhookUrl.trim()}/messages/${messageId}`, 'PATCH', content, fetchImpl);
}

async function webhookRequest(url, method, content, fetchImpl) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messageData(content)),
  };

  let response = await fetchImpl(url, init);
  if (response.status === 429) {
    const wait = retryDelayMs(429, await response.json().catch(() => null));
    if (wait !== null) {
      await sleep(wait);
      response = await fetchImpl(url, init); // uma única nova tentativa
    }
  }

  const result = { ok: response.ok, status: response.status };
  if (response.ok && !response.bodyUsed) {
    const message = await response.json().catch(() => null);
    if (typeof message?.id === 'string') result.messageId = message.id;
  } else if (response.body && !response.bodyUsed) {
    await response.body.cancel();
  }
  return result;
}
