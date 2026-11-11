// Decide o que fazer com cada interação JÁ VALIDADA (assinatura conferida).

import { InteractionType } from '../config/constants.js';
import { findCommand } from '../commands/index.js';
import { isOwner, isOwnerOnly } from '../services/authService.js';
import { json, pong, reply } from '../discord/responses.js';
import { logger, errorFields } from '../services/logger.js';

const GENERIC_ERROR = '⚠️ Ocorreu um erro ao executar este comando. Tente novamente.';

/**
 * Marca o resultado da interação para o log de resumo (ver src/index.js).
 * `meta` é criado por requisição e passado explicitamente: nada de estado global.
 */
function setOutcome(context, outcome, reason) {
  if (!context.meta) return;
  context.meta.outcome = outcome;
  if (reason) context.meta.reason = reason;
}

/**
 * @param {any} interaction Objeto de interação enviado pelo Discord.
 * @param {{ config: ReturnType<import('../config/env.js').getConfig>, env: any, ctx: any, meta?: object }} context
 * @returns {Promise<Response>}
 */
export async function handleInteraction(interaction, context) {
  // Validação de entrada: o mínimo que esperamos de qualquer interação.
  if (!interaction || typeof interaction !== 'object' || !Number.isInteger(interaction.type)) {
    setOutcome(context, 'rejected', 'invalid_interaction');
    return json({ error: 'Interação inválida.' }, 400);
  }

  switch (interaction.type) {
    case InteractionType.PING:
      setOutcome(context, 'pong');
      return pong();

    case InteractionType.APPLICATION_COMMAND:
      return handleCommand(interaction, context);

    default:
      // Botões, modais etc. chegarão nas próximas fases.
      setOutcome(context, 'rejected', 'unsupported_type');
      return json({ error: 'Tipo de interação não suportado.' }, 400);
  }
}

async function handleCommand(interaction, context) {
  const name = interaction.data?.name;
  if (typeof name !== 'string') {
    setOutcome(context, 'rejected', 'missing_command_name');
    return json({ error: 'Comando sem nome.' }, 400);
  }

  const command = findCommand(name);
  if (!command) {
    setOutcome(context, 'unknown_command');
    return reply(`Comando \`/${name}\` não reconhecido. Ele pode ter sido removido.`, {
      ephemeral: true,
    });
  }

  return runCommand(command, interaction, context);
}

/**
 * Aplica as regras comuns a todo comando (permissão + tratamento de erro)
 * e então executa. Exportada para poder ser testada isoladamente.
 */
export async function runCommand(command, interaction, context) {
  const name = command.data.name;

  if (isOwnerOnly(command) && !isOwner(interaction, context.config)) {
    // Se OWNER_ID não estiver configurado, o motivo fica visível nos logs.
    setOutcome(context, 'denied', context.config.ownerId ? 'not_owner' : 'owner_not_configured');
    return reply('🔒 Este comando é restrito ao proprietário do Kaiky Assistant.', {
      ephemeral: true,
    });
  }

  try {
    const response = await command.execute(interaction, context);
    // Um comando precisa devolver um Response; qualquer outra coisa é bug.
    if (!(response instanceof Response)) {
      throw new TypeError(`/${name} não devolveu um Response.`);
    }
    return response;
  } catch (error) {
    // Registra o erro para você ver nos logs, mas não expõe detalhes ao usuário.
    setOutcome(context, 'error');
    logger.error('command_failed', { command: name, interaction_id: interaction.id, ...errorFields(error) });
    return reply(GENERIC_ERROR, { ephemeral: true });
  }
}
