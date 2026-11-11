// Funções puras usadas pelo script de registro (fáceis de testar, sem rede).

export const SNOWFLAKE = /^\d{17,20}$/;
const NAME_RULE = /^[-_ʼ\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

/** Confere nome e descrição de cada comando conforme as regras do Discord. */
export function validateDefinitions(definitions) {
  const errors = [];
  const seen = new Set();
  for (const def of definitions) {
    if (!NAME_RULE.test(def.name) || def.name !== def.name.toLowerCase()) {
      errors.push(`Nome inválido: "${def.name}" (use minúsculas, 1 a 32 caracteres).`);
    }
    if (!def.description || def.description.length > 100) {
      errors.push(`Descrição de /${def.name} precisa ter de 1 a 100 caracteres.`);
    }
    if (seen.has(def.name)) errors.push(`Comando /${def.name} aparece duas vezes.`);
    seen.add(def.name);
  }
  return errors;
}

/**
 * Normaliza só os campos que nós controlamos, para comparar o que está no
 * Discord com o que está no código. O Discord devolve campos extras (id,
 * version...) e usa `null` onde nós simplesmente não enviamos nada.
 */
function comparable(def) {
  return JSON.stringify({
    type: def.type ?? 1,
    description: def.description ?? '',
    options: def.options ?? [],
    default_member_permissions: def.default_member_permissions ?? null,
  });
}

/**
 * Compara a lista atual (do Discord) com a desejada (do código).
 * Lembre: o PUT de "bulk overwrite" SUBSTITUI tudo. O que não estiver na
 * lista desejada será REMOVIDO do Discord.
 *
 * @returns {{ create: string[], update: string[], unchanged: string[], remove: string[] }}
 */
export function planCommandChanges(current, desired) {
  const currentByName = new Map(current.map((def) => [def.name, def]));
  const desiredNames = new Set(desired.map((def) => def.name));
  const plan = { create: [], update: [], unchanged: [], remove: [] };

  for (const def of desired) {
    const existing = currentByName.get(def.name);
    if (!existing) plan.create.push(def.name);
    else if (comparable(existing) !== comparable(def)) plan.update.push(def.name);
    else plan.unchanged.push(def.name);
  }
  for (const def of current) {
    if (!desiredNames.has(def.name)) plan.remove.push(def.name);
  }
  return plan;
}

export function hasChanges(plan) {
  return plan.create.length + plan.update.length + plan.remove.length > 0;
}
