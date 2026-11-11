// Funções puras usadas pelo script de registro (fáceis de testar, sem rede).

export const SNOWFLAKE = /^\d{17,20}$/;
const NAME_RULE = /^[-_ʼ\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

/** Confere nome e descrição (comando ou opção) conforme as regras do Discord. */
function checkNameAndDescription(item, label, errors) {
  if (typeof item.name !== 'string' || !NAME_RULE.test(item.name) || item.name !== item.name.toLowerCase()) {
    errors.push(`Nome inválido em ${label}: "${item.name}" (use minúsculas, 1 a 32 caracteres).`);
  }
  if (!item.description || item.description.length > 100) {
    errors.push(`Descrição de ${label} precisa ter de 1 a 100 caracteres.`);
  }
}

/** Confere as opções (e subcomandos) de forma recursiva. */
function checkOptions(options, label, errors) {
  if (!options) return;
  if (options.length > 25) errors.push(`${label} tem mais de 25 opções.`);
  const seen = new Set();
  let sawOptional = false;
  for (const option of options) {
    const optionLabel = `${label} ${option.name}`;
    checkNameAndDescription(option, optionLabel, errors);
    if (seen.has(option.name)) errors.push(`Opção repetida em ${label}: "${option.name}".`);
    seen.add(option.name);
    // O Discord exige que as opções obrigatórias venham antes das opcionais.
    if (option.required && sawOptional) errors.push(`Em ${label}, "${option.name}" é obrigatória mas vem depois de uma opcional.`);
    if (!option.required && option.type !== 1 && option.type !== 2) sawOptional = true;
    if (option.choices && option.choices.length > 25) errors.push(`${optionLabel} tem mais de 25 escolhas.`);
    checkOptions(option.options, optionLabel, errors);
  }
}

/** Confere comandos e opções conforme as regras do Discord. */
export function validateDefinitions(definitions) {
  const errors = [];
  const seen = new Set();
  for (const def of definitions) {
    checkNameAndDescription(def, `/${def.name}`, errors);
    if (seen.has(def.name)) errors.push(`Comando /${def.name} aparece duas vezes.`);
    seen.add(def.name);
    checkOptions(def.options, `/${def.name}`, errors);
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
