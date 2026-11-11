// Registro central de comandos.
//
// Para adicionar um comando novo:
//   1. Crie o arquivo dentro da pasta do módulo (ex.: commands/tarefas/tarefa.js)
//   2. Importe-o aqui e coloque na lista `commands`
//   3. Rode `npm run register` para avisar o Discord
// O roteador e o script de registro leem desta mesma lista, então não há
// duplicação: definição e execução ficam sempre juntas.

import ping from './central/ping.js';

export const commands = [ping];

/** Mapa nome → comando, para achar o comando em O(1) a cada interação. */
const byName = new Map(commands.map((command) => [command.data.name, command]));

export function findCommand(name) {
  return byName.get(name) ?? null;
}

/** Definições no formato que a API do Discord espera no registro. */
export function getCommandDefinitions() {
  return commands.map((command) => ({ type: 1, ...command.data }));
}
