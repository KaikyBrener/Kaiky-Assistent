// /ajuda — lista os comandos a partir do próprio registro (nunca fica desatualizada).

import { reply } from '../../discord/responses.js';
import { OptionType } from '../../config/constants.js';
import { isOwnerOnly } from '../../services/authService.js';

export function montarAjuda(lista) {
  const linhas = ['📖 **Comandos do Kaiky Assistant**'];
  for (const command of lista) {
    const cadeado = isOwnerOnly(command) ? ' 🔒' : '';
    const subs = (command.data.options ?? []).filter((o) => o.type === OptionType.SUB_COMMAND);
    if (subs.length === 0) {
      linhas.push(`• \`/${command.data.name}\`${cadeado} — ${command.data.description}`);
      continue;
    }
    linhas.push(`• \`/${command.data.name}\`${cadeado}`);
    for (const sub of subs) linhas.push(`  ◦ \`${sub.name}\` — ${sub.description}`);
  }
  linhas.push('', '🔒 = só o proprietário pode usar.');
  return linhas.join('\n');
}

export default {
  data: { name: 'ajuda', description: 'Mostra os comandos disponíveis.' },
  ownerOnly: false, // só lista nomes de comandos: não expõe nenhum dado
  async execute() {
    // Import dinâmico: index.js importa este arquivo, então um import normal
    // daqui para lá criaria um ciclo que quebra dependendo da ordem de carga.
    const { commands } = await import('../index.js');
    return reply(montarAjuda(commands), { ephemeral: true });
  },
};
