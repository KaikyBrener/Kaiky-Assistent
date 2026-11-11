// Números "mágicos" definidos pela documentação do Discord.
// Dar nome a eles deixa o código legível: InteractionType.PING em vez de 1.
// Fonte: https://docs.discord.com/developers/interactions/receiving-and-responding

/** Tipos de interação que o Discord envia para o nosso endpoint. */
export const InteractionType = Object.freeze({
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
});

/** Tipos de resposta que devolvemos ao Discord. */
export const InteractionResponseType = Object.freeze({
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
});

/** Flags de mensagem. EPHEMERAL = só quem usou o comando vê a resposta. */
export const MessageFlags = Object.freeze({
  EPHEMERAL: 1 << 6, // 64
});

/** Tipo de comando de barra (slash command). */
export const ApplicationCommandType = Object.freeze({
  CHAT_INPUT: 1,
});

/** Tipos de opção de um comando (o que o usuário preenche). */
export const OptionType = Object.freeze({
  SUB_COMMAND: 1,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
});

/** Discord conta o tempo a partir desta data nos IDs (snowflakes). */
export const DISCORD_EPOCH_MS = 1420070400000n;
