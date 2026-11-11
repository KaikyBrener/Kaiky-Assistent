// /tarefa — criar, listar, concluir e excluir tarefas.
//
// - Restrito ao proprietário: não declaramos `ownerOnly`, então vale o padrão
//   "negado para quem não é o OWNER_ID".
// - Respostas efêmeras: só você vê, porque são dados pessoais.
// - Anti-duplicidade: a criação usa o ID da interação (ver docs/idempotencia-fase2.md).

import { OptionType } from '../../config/constants.js';
import { reply } from '../../discord/responses.js';
import { readSubcommand } from '../../discord/options.js';
import { logger } from '../../services/logger.js';
import * as tarefas from '../../services/tarefaService.js';
import { escapeMarkdown, formatarTarefa, detalhesTarefa } from '../../services/tarefaFormat.js';
import { formatDateTime } from '../../services/dateTime.js';
import { replyEmbed } from '../../discord/responses.js';
import { modalResponse, readModalValues, TextStyle } from '../../discord/modal.js';

const contextoChoices = tarefas.CONTEXTOS.map((valor) => ({ name: valor, value: valor }));
const tipoChoices = tarefas.TIPOS.map((valor) => ({ name: valor === 'reuniao' ? 'reunião' : valor, value: valor }));

/** Formulário para escrever a descrição longa (várias linhas) de uma tarefa. */
export function formularioDescricao(tarefa) {
  return modalResponse({
    customId: `tarefa:descrever:${tarefa.id}`,
    title: `Descrição da tarefa #${tarefa.id}`,
    fields: [
      {
        id: 'descricao',
        label: 'Descrição',
        description: 'Detalhes, passos, links… Deixe vazio para apagar.',
        style: TextStyle.PARAGRAPH,
        required: false,
        maxLength: tarefas.TEXTO_LONGO_MAX,
        value: tarefa.descricao,
      },
    ],
  });
}

const idOption = {
  type: OptionType.INTEGER,
  name: 'id',
  description: 'Número da tarefa (aparece no /tarefa listar).',
  required: true,
  min_value: 1,
};

// A formatação mora em services/tarefaFormat.js (compartilhada com painel e Cron).
export { escapeMarkdown, formatarTarefa };

export function formatarLista({ tarefas: lista, total }, { contexto, todas }) {
  const filtro = [contexto ?? 'todos os contextos', todas ? 'incluindo concluídas' : 'só pendentes'].join(', ');
  if (lista.length === 0) return `📭 Nenhuma tarefa encontrada (${filtro}).`;
  const linhas = lista.map(formatarTarefa);
  const resto = total - lista.length;
  if (resto > 0) linhas.push(`… e mais ${resto}. Use o filtro de contexto para ver outras.`);
  return [`📋 **Tarefas** (${filtro}):`, ...linhas].join('\n');
}

const handlers = {
  async criar(db, values, interaction) {
    const { tarefa, repetida } = await tarefas.criar(db, {
      titulo: values.titulo,
      contexto: values.contexto,
      prazo: values.prazo,
      tipo: values.tipo,
      interactionId: interaction.id,
    });
    // descrever:True → a tarefa já foi criada; agora abre o formulário da descrição.
    if (values.descrever === true) return formularioDescricao(tarefa);
    if (repetida) return `ℹ️ Esta solicitação já tinha sido processada: ${formatarTarefa(tarefa)}`;
    const aviso = tarefa.prazo
      ? `\n⏰ Vence em ${formatDateTime(tarefa.prazo)} (horário de Brasília). Você recebe um lembrete no #kaiky até 1 hora antes.`
      : '';
    return `✅ Tarefa criada: ${formatarTarefa(tarefa)}${aviso}`;
  },

  async listar(db, values) {
    const resultado = await tarefas.listar(db, { contexto: values.contexto, todas: values.todas });
    return formatarLista(resultado, { contexto: values.contexto, todas: values.todas === true });
  },

  async concluir(db, values) {
    const { status, tarefa } = await tarefas.concluir(db, { id: values.id });
    if (status === 'nao_encontrada') return `🔎 Tarefa #${values.id} não encontrada.`;
    if (status === 'ja_concluida') return `ℹ️ A tarefa já estava concluída: ${formatarTarefa(tarefa)}`;
    return `🎉 Concluída: ${formatarTarefa(tarefa)}`;
  },

  async excluir(db, values) {
    const tarefa = await tarefas.excluir(db, { id: values.id });
    if (!tarefa) return `🔎 Tarefa #${values.id} não encontrada.`;
    return `🗑️ Excluída: #${tarefa.id} · ${escapeMarkdown(tarefa.titulo)}`;
  },

  async ver(db, values) {
    const tarefa = await tarefas.obter(db, { id: values.id });
    if (!tarefa) return `🔎 Tarefa #${values.id} não encontrada.`;
    return replyEmbed(detalhesTarefa(tarefa), { ephemeral: true });
  },

  async descrever(db, values) {
    const tarefa = await tarefas.obter(db, { id: values.id });
    if (!tarefa) return `🔎 Tarefa #${values.id} não encontrada.`;
    return formularioDescricao(tarefa); // abre o formulário já com a descrição atual
  },
};

/** Respostas dos formulários: hoje só "tarefa:descrever:<id>". */
const modalHandlers = {
  async descrever(db, values, id) {
    const tarefa = await tarefas.descrever(db, { id, descricao: values.descricao });
    if (!tarefa) return `🔎 Tarefa #${id} não encontrada.`;
    return tarefa.descricao
      ? `📄 Descrição salva: ${formatarTarefa(tarefa)}\nVeja com \`/tarefa ver id:${tarefa.id}\`.`
      : `🧹 Descrição apagada: ${formatarTarefa(tarefa)}`;
  },
};

/** Executa um handler e trata o resultado: texto vira mensagem efêmera; Response passa direto. */
async function responder(db, run) {
  try {
    const resultado = await run(db);
    return resultado instanceof Response ? resultado : reply(resultado, { ephemeral: true });
  } catch (error) {
    // Erro de validação é culpa da entrada: mostramos a mensagem ao usuário.
    if (error instanceof tarefas.ValidationError) return reply(`⚠️ ${error.message}`, { ephemeral: true });
    throw error; // outros erros: o roteador registra no log e responde de forma genérica
  }
}

function bancoAusente() {
  logger.error('config_invalid', { command: 'tarefa', reason: 'd1_binding_missing' });
  return reply('⚠️ O banco de dados não está configurado.', { ephemeral: true });
}

export default {
  data: {
    name: 'tarefa',
    description: 'Gerencia suas tarefas pessoais e profissionais.',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'criar',
        description: 'Cria uma nova tarefa.',
        options: [
          {
            type: OptionType.STRING,
            name: 'titulo',
            description: 'O que precisa ser feito.',
            required: true,
            max_length: tarefas.TITULO_MAX,
          },
          {
            type: OptionType.STRING,
            name: 'contexto',
            description: 'Pessoal ou profissional (padrão: pessoal).',
            choices: contextoChoices,
          },
          {
            type: OptionType.STRING,
            name: 'prazo',
            description: 'Opcional. DD/MM/AAAA HH:MM ou DD/MM/AAAA (horário de Brasília).',
            max_length: 16,
          },
          { type: OptionType.STRING, name: 'tipo', description: 'tarefa, melhoria, estudo ou reunião (padrão: tarefa).', choices: tipoChoices },
          { type: OptionType.BOOLEAN, name: 'descrever', description: 'Abrir um formulário para escrever uma descrição longa.' },
        ],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'listar',
        description: 'Lista suas tarefas.',
        options: [
          { type: OptionType.STRING, name: 'contexto', description: 'Filtra por contexto.', choices: contextoChoices },
          { type: OptionType.BOOLEAN, name: 'todas', description: 'Incluir as concluídas.' },
        ],
      },
      { type: OptionType.SUB_COMMAND, name: 'concluir', description: 'Marca uma tarefa como concluída.', options: [idOption] },
      { type: OptionType.SUB_COMMAND, name: 'excluir', description: 'Exclui uma tarefa.', options: [idOption] },
      { type: OptionType.SUB_COMMAND, name: 'ver', description: 'Mostra todos os detalhes, com a descrição.', options: [idOption] },
      { type: OptionType.SUB_COMMAND, name: 'descrever', description: 'Abre o formulário da descrição longa.', options: [idOption] },
    ],
  },

  async execute(interaction, { env }) {
    const sub = readSubcommand(interaction);
    const handler = sub && Object.hasOwn(handlers, sub.name) ? handlers[sub.name] : null;
    if (!handler) return reply('Subcomando não reconhecido.', { ephemeral: true });
    if (!env?.DB) return bancoAusente();
    return responder(env.DB, (db) => handler(db, sub.values, interaction));
  },

  /** Envio de formulário. `parsed` vem do custom_id, ex.: { action: 'descrever', id: 12 }. */
  async handleModal(interaction, { env }, parsed) {
    const handler = Object.hasOwn(modalHandlers, parsed.action) ? modalHandlers[parsed.action] : null;
    if (!handler || parsed.id === null) return reply('Formulário não reconhecido.', { ephemeral: true });
    if (!env?.DB) return bancoAusente();
    return responder(env.DB, (db) => handler(db, readModalValues(interaction), parsed.id));
  },
};
