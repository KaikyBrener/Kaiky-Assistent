// Funções pequenas para montar respostas HTTP.
// Toda resposta ao Discord precisa ser JSON com Content-Type correto.

import { InteractionResponseType, MessageFlags } from '../config/constants.js';

const JSON_HEADERS = { 'Content-Type': 'application/json;charset=UTF-8' };

/** Resposta JSON genérica. */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Resposta de texto simples (erros HTTP e checagem de saúde). */
export function text(message, status = 200) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  });
}

/** Resposta ao PING do Discord (usado quando você salva a URL no portal). */
export function pong() {
  return json({ type: InteractionResponseType.PONG });
}

/**
 * Monta o conteúdo de uma mensagem do bot.
 * Usado tanto na resposta imediata quanto na edição de uma resposta adiada.
 * @param {string} content Texto da mensagem (máx. 2000 caracteres no Discord).
 */
export function messageData(content) {
  return {
    content: String(content).slice(0, 2000),
    // Evita que o bot mencione @everyone/@here ou pessoas por acidente.
    allowed_mentions: { parse: [] },
  };
}

/**
 * Responde à interação com uma mensagem no canal.
 * @param {string} content Texto da mensagem (máx. 2000 caracteres no Discord).
 * @param {{ ephemeral?: boolean }} [options]
 */
export function reply(content, { ephemeral = false } = {}) {
  const data = messageData(content);
  if (ephemeral) data.flags = MessageFlags.EPHEMERAL;
  return json({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data });
}

/**
 * Resposta "adiada": o Discord mostra "Kaiky Assistant está pensando..."
 * e nos dá até 15 minutos para editar a mensagem com o resultado.
 * O único flag permitido aqui é EPHEMERAL.
 */
export function deferredReply({ ephemeral = false } = {}) {
  const body = { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE };
  if (ephemeral) body.data = { flags: MessageFlags.EPHEMERAL };
  return json(body);
}
