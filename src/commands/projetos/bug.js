// /bug — documenta bugs: o problema, como reproduzir e como foi resolvido.
//
// Fluxo:
//   /bug registrar           → abre um formulário (título, sistema, problema, como reproduzir)
//   /bug resolver id:3       → abre um formulário (causa, solução, PR/link) e marca como resolvido
//   /bug ver id:3            → mostra tudo
//   /bug listar / buscar     → encontra bugs antigos ("como resolvi aquilo mesmo?")
// Restrito ao proprietário e com respostas efêmeras.

import { OptionType } from '../../config/constants.js';
import { reply, replyEmbed } from '../../discord/responses.js';
import { readSubcommand } from '../../discord/options.js';
import { modalResponse, readModalValues, TextStyle } from '../../discord/modal.js';
import { logger } from '../../services/logger.js';
import { ValidationError, TITULO_MAX, TEXTO_LONGO_MAX } from '../../services/tarefaService.js';
import { juntarComLimite, escapeMarkdown } from '../../services/tarefaFormat.js';
import * as bugs from '../../services/bugService.js';

const idOption = { type: OptionType.INTEGER, name: 'id', description: 'Número do bug (aparece no /bug listar).', required: true, min_value: 1 };

export function formularioRegistro({ titulo, sistema } = {}) {
  return modalResponse({
    customId: 'bug:registrar',
    title: 'Registrar bug',
    fields: [
      { id: 'titulo', label: 'Título', style: TextStyle.SHORT, required: true, maxLength: TITULO_MAX, value: titulo },
      { id: 'sistema', label: 'Sistema / projeto', description: 'Ex.: Horus, Prova-On, Kaiky Assistant', style: TextStyle.SHORT, required: true, maxLength: bugs.SISTEMA_MAX, value: sistema },
      { id: 'descricao', label: 'O que acontece?', description: 'Comportamento errado, mensagem de erro, tela…', required: true, maxLength: TEXTO_LONGO_MAX },
      { id: 'como_reproduzir', label: 'Como reproduzir (opcional)', description: 'Passo a passo para o bug aparecer.', required: false, maxLength: TEXTO_LONGO_MAX },
    ],
  });
}

export function formularioResolucao(bug) {
  return modalResponse({
    customId: `bug:resolver:${bug.id}`,
    title: `Resolver bug #${bug.id}`,
    fields: [
      { id: 'causa', label: 'Causa (opcional)', description: 'Por que acontecia?', required: false, maxLength: TEXTO_LONGO_MAX, value: bug.causa },
      { id: 'solucao', label: 'Como foi resolvido', description: 'O que mudou, arquivos, testes… (pode colar a descrição do PR)', required: true, maxLength: TEXTO_LONGO_MAX, value: bug.solucao },
      { id: 'referencia', label: 'PR / link / commit (opcional)', style: TextStyle.SHORT, required: false, maxLength: bugs.REFERENCIA_MAX, value: bug.referencia },
    ],
  });
}

const naoEncontrado = (id) => `🔎 Bug #${id} não encontrado.`;

const handlers = {
  registrar: (db, values) => formularioRegistro({ titulo: values.titulo, sistema: values.sistema }),

  async resolver(db, values) {
    const bug = await bugs.obter(db, { id: values.id });
    return bug ? formularioResolucao(bug) : naoEncontrado(values.id);
  },

  async reabrir(db, values) {
    const bug = await bugs.reabrir(db, { id: values.id });
    return bug ? `🔁 Reaberto: ${bugs.formatarBug(bug)}` : naoEncontrado(values.id);
  },

  async ver(db, values) {
    const bug = await bugs.obter(db, { id: values.id });
    return bug ? replyEmbed(bugs.detalhesBug(bug), { ephemeral: true }) : naoEncontrado(values.id);
  },

  async listar(db, values) {
    const status = values.status ?? 'abertos';
    const { bugs: lista, total } = await bugs.listar(db, { status, sistema: values.sistema });
    const filtro = [status, values.sistema ? `sistema ${escapeMarkdown(values.sistema)}` : null].filter(Boolean).join(', ');
    if (lista.length === 0) return `📭 Nenhum bug encontrado (${filtro}).`;
    const linhas = lista.map(bugs.formatarBug);
    if (total > lista.length) linhas.push(`… e mais ${total - lista.length}.`);
    return juntarComLimite(`🐛 **Bugs** (${filtro}):`, linhas);
  },

  async buscar(db, values) {
    const lista = await bugs.buscar(db, { termo: values.termo });
    if (lista.length === 0) return `🔎 Nada encontrado para "${escapeMarkdown(values.termo)}".`;
    return juntarComLimite(`🔎 **Resultados para "${escapeMarkdown(values.termo)}":**`, [
      ...lista.map(bugs.formatarBug),
      'Veja os detalhes com `/bug ver id:<número>`.',
    ]);
  },
};

const modalHandlers = {
  async registrar(db, values, _id, interaction) {
    const { bug, repetido } = await bugs.registrar(db, {
      titulo: values.titulo,
      sistema: values.sistema,
      descricao: values.descricao,
      comoReproduzir: values.como_reproduzir,
      interactionId: interaction.id,
    });
    if (repetido) return `ℹ️ Este envio já tinha sido registrado: ${bugs.formatarBug(bug)}`;
    return `🐛 Bug registrado: ${bugs.formatarBug(bug)}\nQuando resolver: \`/bug resolver id:${bug.id}\`.`;
  },

  async resolver(db, values, id) {
    if (id === null) return 'Formulário não reconhecido.';
    const bug = await bugs.resolver(db, { id, causa: values.causa, solucao: values.solucao, referencia: values.referencia });
    return bug ? `✅ Resolução documentada: ${bugs.formatarBug(bug)}\nVeja com \`/bug ver id:${bug.id}\`.` : naoEncontrado(id);
  },
};

async function responder(env, run) {
  if (!env?.DB) {
    logger.error('config_invalid', { command: 'bug', reason: 'd1_binding_missing' });
    return reply('⚠️ O banco de dados não está configurado.', { ephemeral: true });
  }
  try {
    const resultado = await run(env.DB);
    return resultado instanceof Response ? resultado : reply(resultado, { ephemeral: true });
  } catch (error) {
    if (error instanceof ValidationError) return reply(`⚠️ ${error.message}`, { ephemeral: true });
    throw error;
  }
}

export default {
  data: {
    name: 'bug',
    description: 'Documenta bugs: o problema e como foi resolvido.',
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: 'registrar',
        description: 'Abre o formulário para registrar um bug.',
        options: [
          { type: OptionType.STRING, name: 'titulo', description: 'Opcional: já preenche o título.', max_length: TITULO_MAX },
          { type: OptionType.STRING, name: 'sistema', description: 'Opcional: já preenche o sistema (ex.: Horus).', max_length: bugs.SISTEMA_MAX },
        ],
      },
      { type: OptionType.SUB_COMMAND, name: 'resolver', description: 'Documenta como o bug foi resolvido.', options: [idOption] },
      { type: OptionType.SUB_COMMAND, name: 'reabrir', description: 'Reabre um bug resolvido.', options: [idOption] },
      { type: OptionType.SUB_COMMAND, name: 'ver', description: 'Mostra o bug completo, com a resolução.', options: [idOption] },
      {
        type: OptionType.SUB_COMMAND,
        name: 'listar',
        description: 'Lista bugs.',
        options: [
          {
            type: OptionType.STRING,
            name: 'status',
            description: 'abertos (padrão), resolvidos ou todos.',
            choices: Object.keys(bugs.STATUS_FILTRO).map((s) => ({ name: s, value: s })),
          },
          { type: OptionType.STRING, name: 'sistema', description: 'Filtra por sistema (ex.: Horus).', max_length: bugs.SISTEMA_MAX },
        ],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: 'buscar',
        description: 'Procura em títulos, descrições, causas e soluções.',
        options: [{ type: OptionType.STRING, name: 'termo', description: 'Ex.: impressão, botão, col-xs', required: true, min_length: 2, max_length: 100 }],
      },
    ],
  },

  async execute(interaction, { env }) {
    const sub = readSubcommand(interaction);
    const handler = sub && Object.hasOwn(handlers, sub.name) ? handlers[sub.name] : null;
    if (!handler) return reply('Subcomando não reconhecido.', { ephemeral: true });
    // "registrar" só abre o formulário: não precisa do banco ainda.
    if (sub.name === 'registrar') return handler(null, sub.values);
    return responder(env, (db) => handler(db, sub.values));
  },

  async handleModal(interaction, { env }, parsed) {
    const handler = Object.hasOwn(modalHandlers, parsed.action) ? modalHandlers[parsed.action] : null;
    if (!handler) return reply('Formulário não reconhecido.', { ephemeral: true });
    return responder(env, (db) => handler(db, readModalValues(interaction), parsed.id, interaction));
  },
};
