// Decide o que fazer com cada interação JÁ VALIDADA (assinatura conferida).

import { InteractionType } from '../config/constants.js';
import { findCommand } from '../commands/index.js';
import { isOwner } from '../services/authService.js';
import { json, pong, reply } from '../discord/responses.js';

/**
 * @param {any} interaction Objeto de interação enviado pelo Discord.
 * @param {{ config: ReturnType<import('../config/env.js').getConfig>, env: any, ctx: any }} context
 * @returns {Promise<Response>}
 */
export async function handleInteraction(interaction, context) {
  // Validação de entrada: o mínimo que esperamos de qualquer interação.
  if (!interaction || typeof interaction !== 'object' || !Number.isInteger(interaction.type)) {
    return json({ error: 'Interação inválida.' }, 400);
  }

  switch (interaction.type) {
    case InteractionType.PING:
      return pong();

    case InteractionType.APPLICATION_COMMAND:
      return handleCommand(interaction, context);

    default:
      // Botões, modais etc. chegarão nas próximas fases.
      return json({ error: 'Tipo de interação não suportado.' }, 400);
  }
}

async function handleCommand(interaction, context) {
  const name = interaction.data?.name;
  if (typeof name !== 'string') {
    return json({ error: 'Comando sem nome.' }, 400);
  }

  const command = findCommand(name);
  if (!command) {
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

  if (command.ownerOnly && !isOwner(interaction, context.config)) {
    return reply('🔒 Este comando é restrito ao proprietário do Kaiky Assistant.', {
      ephemeral: true,
    });
  }

  try {
    return await command.execute(interaction, context);
  } catch (error) {
    // Registra o erro para você ver nos logs, mas não expõe detalhes ao usuário.
    console.error(`Erro ao executar /${name}:`, error?.stack ?? error);
    return reply('⚠️ Ocorreu um erro ao executar este comando. Tente novamente.', {
      ephemeral: true,
    });
  }
}
