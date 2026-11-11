// /ping — confirma que o Kaiky Assistant está vivo e mostra a latência.
//
// Todo comando segue o mesmo formato:
//   data     → definição enviada ao Discord no registro (nome, descrição, opções)
//   ownerOnly → por padrão TODO comando é só do proprietário (OWNER_ID).
//               Use `ownerOnly: false` apenas em comandos inofensivos, como este.
//   execute  → função que recebe a interação e devolve a resposta

import { reply } from '../../discord/responses.js';
import { DISCORD_EPOCH_MS } from '../../config/constants.js';

/**
 * O ID de toda interação é um "snowflake": os bits mais altos guardam o
 * momento em que ela foi criada. Comparando com a hora atual, temos uma
 * estimativa do tempo entre o Discord criar a interação e ela chegar aqui.
 */
export function snowflakeToTimestamp(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
}

export default {
  data: {
    name: 'ping',
    description: 'Verifica se o Kaiky Assistant está online.',
  },
  ownerOnly: false,

  async execute(interaction, { config }) {
    let latency = '';
    try {
      const ms = Date.now() - snowflakeToTimestamp(interaction.id);
      if (ms >= 0 && ms < 60_000) latency = ` Latência: ~${ms} ms.`;
    } catch {
      // ID em formato inesperado: apenas não mostramos a latência.
    }
    return reply(`🏓 Pong! ${config.appName} está online.${latency}`);
  },
};
