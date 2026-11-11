// Lê as opções que o usuário preencheu num comando.
//
// Com subcomandos (ex.: /tarefa criar titulo:"Estudar"), o Discord envia:
//   data.options = [ { name: "criar", type: 1, options: [ { name: "titulo", value: "Estudar" } ] } ]
// Esta função transforma isso em: { name: "criar", values: { titulo: "Estudar" } }

import { OptionType } from '../config/constants.js';

export function readSubcommand(interaction) {
  const sub = interaction?.data?.options?.[0];
  if (!sub || sub.type !== OptionType.SUB_COMMAND || typeof sub.name !== 'string') return null;

  const values = {};
  for (const option of sub.options ?? []) {
    if (typeof option?.name === 'string' && 'value' in option) values[option.name] = option.value;
  }
  return { name: sub.name, values };
}
