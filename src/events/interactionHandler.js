// Decide o que fazer com cada interação JÁ VALIDADA (assinatura conferida).

import { InteractionType } from '../config/constants.js';
import { findCommand } from '../commands/index.js';
import { isOwner, isOwnerOnly } from '../services/authService.js';
import { json, pong, reply, deferredReply, messageData } from '../discord/responses.js';
import { editOriginalResponse } from '../discord/followup.js';
import { parseModalCustomId } from '../discord/modal.js';
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

    case InteractionType.MODAL_SUBMIT:
      return handleModalSubmit(interaction, context);

    default:
      // Botões, menus etc. ainda não são usados.
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
 * Envio de um formulário (modal). O custom_id diz qual comando o abriu,
 * ex.: "tarefa:descrever:12". O comando precisa ter `handleModal`.
 * As MESMAS regras valem aqui: permissão do proprietário e tratamento de erro.
 */
async function handleModalSubmit(interaction, context) {
  const parsed = parseModalCustomId(interaction.data?.custom_id);
  const command = parsed ? findCommand(parsed.command) : null;
  if (!command || typeof command.handleModal !== 'function') {
    setOutcome(context, 'rejected', 'unknown_modal');
    return reply('Formulário não reconhecido.', { ephemeral: true });
  }
  if (context.meta) context.meta.reason = `modal:${parsed.command}:${parsed.action}`;
  return runCommand(command, interaction, context, {
    handler: (i, ctx) => command.handleModal(i, ctx, parsed),
  });
}

/**
 * Aplica as regras comuns a todo comando (permissão + tratamento de erro)
 * e então executa. Exportada para poder ser testada isoladamente.
 * `options.handler` substitui `command.execute` (usado no envio de formulários).
 */
export async function runCommand(command, interaction, context, options = {}) {
  const name = command.data.name;
  const execute = options.handler ?? ((i, ctx) => command.execute(i, ctx));

  if (isOwnerOnly(command) && !isOwner(interaction, context.config)) {
    // Se OWNER_ID não estiver configurado, o motivo fica visível nos logs.
    setOutcome(context, 'denied', context.config.ownerId ? 'not_owner' : 'owner_not_configured');
    return reply('🔒 Este comando é restrito ao proprietário do Kaiky Assistant.', {
      ephemeral: true,
    });
  }

  // Comando demorado: responde já com "pensando..." e termina em segundo plano.
  if (command.deferred && !options.handler) return startDeferred(command, interaction, context);

  try {
    const response = await execute(interaction, context);
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

/**
 * Comandos adiados (`deferred: true`).
 *
 * O Discord exige uma resposta em até 3 segundos. Para trabalhos mais longos:
 *   1. respondemos NA HORA com DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (type 5);
 *   2. `ctx.waitUntil()` mantém o Worker vivo depois da resposta (até 30 s);
 *   3. quando o trabalho termina, editamos a mensagem "pensando..." com o resultado.
 *
 * Num comando adiado, `execute` devolve o TEXTO da resposta (não um Response).
 */
function startDeferred(command, interaction, context) {
  if (context.meta) context.meta.deferred = true;
  context.ctx.waitUntil(finishDeferred(command, interaction, context));
  return deferredReply({ ephemeral: command.ephemeral === true });
}

async function finishDeferred(command, interaction, context) {
  const name = command.data.name;
  let content;
  try {
    content = await command.execute(interaction, context);
    if (typeof content !== 'string') throw new TypeError(`/${name} adiado deve devolver texto.`);
  } catch (error) {
    logger.error('command_failed', { command: name, interaction_id: interaction.id, deferred: true, ...errorFields(error) });
    content = GENERIC_ERROR;
  }

  try {
    const result = await editOriginalResponse(interaction.application_id, interaction.token, messageData(content));
    if (!result.ok) {
      logger.error('followup_failed', { command: name, interaction_id: interaction.id, http_status: result.status });
    }
  } catch (error) {
    logger.error('followup_failed', { command: name, interaction_id: interaction.id, ...errorFields(error) });
  }
}
