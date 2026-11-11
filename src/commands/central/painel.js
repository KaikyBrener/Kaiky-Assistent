// /painel — visão geral das tarefas (só você vê).
// Restrito ao proprietário pelo padrão "negado por padrão" (sem ownerOnly).

import { reply } from '../../discord/responses.js';
import { carregarResumo, montarPainel } from '../../services/resumoService.js';
import { logger } from '../../services/logger.js';

export default {
  data: { name: 'painel', description: 'Resumo das suas tarefas e da sua produtividade.' },
  async execute(interaction, { env }) {
    if (!env?.DB) {
      logger.error('config_invalid', { command: 'painel', reason: 'd1_binding_missing' });
      return reply('⚠️ O banco de dados não está configurado.', { ephemeral: true });
    }
    const agora = Date.now();
    return reply(montarPainel(await carregarResumo(env.DB, agora), agora), { ephemeral: true });
  },
};
