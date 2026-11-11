// Job: mantém UMA mensagem fixa no canal #dashboard, editada a cada 5 minutos.
//
//  - Primeira vez: cria a mensagem e guarda o ID dela no D1 (tabela estado).
//  - Depois: só EDITA essa mensagem (o canal não enche de mensagens novas).
//  - Se você apagar a mensagem, o Discord responde 404 e o job cria outra.
//  - Duas execuções ao mesmo tempo não criam duas mensagens: a criação é reservada.
// O webhook do #dashboard é OPCIONAL (DISCORD_DASHBOARD_WEBHOOK_URL).

import * as estado from '../database/estadoRepository.js';
import { listarPendentesPorPrazo } from '../database/tarefasRepository.js';
import { listarBugs } from '../database/bugsRepository.js';
import { sendWebhookMessage, editWebhookMessage, isValidWebhookUrl } from '../discord/webhook.js';
import { montarDashboard } from '../services/resumoService.js';
import { logger } from '../services/logger.js';

export const CHAVE = 'dashboard_message_id';
const RESERVA_EXPIRA_MS = 10 * 60 * 1000; // reserva "presa" (Worker caiu no meio) expira em 10 min

async function montarConteudo(db, agora) {
  const [{ tarefas, total, atrasadas }, { bugs, total: totalBugs }] = await Promise.all([
    listarPendentesPorPrazo(db, { agora, limite: 15 }),
    listarBugs(db, { status: 'aberto', limite: 8 }),
  ]);
  return montarDashboard({ tarefas, totalTarefas: total, atrasadas, bugs, totalBugs }, agora);
}

/** @returns {Promise<{ status: string }>} */
export async function atualizarDashboard(env, agora) {
  const url = env.DISCORD_DASHBOARD_WEBHOOK_URL;
  if (!isValidWebhookUrl(url)) return { status: 'nao_configurado' };

  const conteudo = await montarConteudo(env.DB, agora);
  const atual = await estado.obter(env.DB, CHAVE);

  // 1) Já existe a mensagem: edita.
  if (atual?.valor) {
    const r = await editWebhookMessage(url, atual.valor, conteudo);
    if (r.ok) return { status: 'atualizado' };
    if (r.status !== 404) {
      logger.error('notification_failed', { reason: 'dashboard_editar', http_status: r.status });
      return { status: 'falhou' };
    }
    await estado.remover(env.DB, CHAVE); // mensagem apagada: cria outra abaixo
  } else if (atual && agora - atual.atualizado_em < RESERVA_EXPIRA_MS) {
    return { status: 'criacao_em_andamento' }; // outra execução está criando agora
  } else if (atual) {
    await estado.remover(env.DB, CHAVE); // reserva antiga e vazia: libera
  }

  // 2) Cria a mensagem (uma execução por vez).
  if (!(await estado.reservar(env.DB, CHAVE, agora))) return { status: 'criacao_em_andamento' };
  const r = await sendWebhookMessage(url, conteudo);
  if (r.ok && r.messageId) {
    await estado.definir(env.DB, CHAVE, r.messageId, agora);
    return { status: 'criado' };
  }
  await estado.remover(env.DB, CHAVE);
  logger.error('notification_failed', { reason: 'dashboard_criar', http_status: r.status });
  return { status: 'falhou' };
}
