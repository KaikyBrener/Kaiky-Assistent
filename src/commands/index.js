// Registro central de comandos.
//
// Para adicionar um comando novo:
//   1. Crie o arquivo dentro da pasta do módulo (ex.: commands/tarefas/tarefa.js)
//   2. Importe-o aqui e coloque na lista `commands`
//   3. Rode `npm run register` para avisar o Discord
// O roteador e o script de registro leem desta mesma lista, então não há
// duplicação: definição e execução ficam sempre juntas.

import ping from './central/ping.js';
import { isOwnerOnly } from '../services/authService.js';

export const commands = [ping];

/** Mapa nome → comando, para achar o comando em O(1) a cada interação. */
const byName = new Map(commands.map((command) => [command.data.name, command]));

export function findCommand(name) {
  return byName.get(name) ?? null;
}

/**
 * Definições no formato que a API do Discord espera no registro.
 *
 * Comandos restritos ao proprietário ganham `default_member_permissions: "0"`:
 * o Discord passa a esconder o comando de quem não é administrador do servidor.
 * É uma camada EXTRA: a proteção principal continua sendo a checagem no Worker,
 * porque administradores do servidor ainda enxergam o comando.
 */
export function getCommandDefinitions(list = commands) {
  return list.map((command) => {
    const definition = { type: 1, ...command.data };
    if (isOwnerOnly(command)) definition.default_member_permissions = '0';
    return definition;
  });
}
