// Regras de "quem pode fazer o quê".
//
// Em servidor, o Discord manda o usuário em `interaction.member.user`;
// em mensagem direta (DM), em `interaction.user`. Esta função esconde
// essa diferença do resto do código.

/** @returns {string | null} ID do usuário que usou o comando. */
export function getUserId(interaction) {
  return interaction?.member?.user?.id ?? interaction?.user?.id ?? null;
}

/**
 * Regra "negado por padrão": todo comando é restrito ao proprietário,
 * a não ser que declare explicitamente `ownerOnly: false`.
 * Assim, esquecer a propriedade nunca deixa dados pessoais abertos.
 */
export function isOwnerOnly(command) {
  return command?.ownerOnly !== false;
}

/**
 * Verdadeiro somente se o usuário for o proprietário configurado em OWNER_ID.
 * Se OWNER_ID não estiver configurado, retorna false (falha fechada).
 */
export function isOwner(interaction, config) {
  const userId = getUserId(interaction);
  return Boolean(config.ownerId && userId && userId === config.ownerId);
}
