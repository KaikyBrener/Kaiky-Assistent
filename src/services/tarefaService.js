// Regras de negócio das tarefas: validação de entrada + chamada ao banco.
//
// Por que validar aqui se o Discord já limita o tamanho do texto? Porque o
// Discord valida só no aplicativo dele. A regra de ouro é: nunca confie na
// entrada; confira tudo no servidor.

import * as repo from '../database/tarefasRepository.js';

export const TITULO_MAX = 200;
export const CONTEXTOS = Object.freeze(['pessoal', 'profissional']);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Limpa e valida o título: tira espaços extras e quebras de linha. */
export function validarTitulo(valor) {
  if (typeof valor !== 'string') throw new ValidationError('Informe o título da tarefa.');
  const titulo = valor.replace(/\s+/g, ' ').trim();
  if (!titulo) throw new ValidationError('O título não pode ficar vazio.');
  if (titulo.length > TITULO_MAX) {
    throw new ValidationError(`O título pode ter no máximo ${TITULO_MAX} caracteres.`);
  }
  return titulo;
}

/** Sem valor → padrão ('pessoal' na criação, `null` = todos na listagem). */
export function validarContexto(valor, padrao = 'pessoal') {
  if (valor === undefined || valor === null) return padrao;
  if (!CONTEXTOS.includes(valor)) throw new ValidationError('Contexto deve ser "pessoal" ou "profissional".');
  return valor;
}

export function validarId(valor) {
  if (!Number.isSafeInteger(valor) || valor < 1) throw new ValidationError('Informe um número de tarefa válido.');
  return valor;
}

export async function criar(db, { titulo, contexto, interactionId, agora = Date.now() }) {
  if (typeof interactionId !== 'string' || !interactionId) throw new ValidationError('Interação sem ID.');
  return repo.criarTarefa(db, {
    titulo: validarTitulo(titulo),
    contexto: validarContexto(contexto),
    interactionId,
    agora,
  });
}

export async function listar(db, { contexto, todas }) {
  return repo.listarTarefas(db, {
    contexto: validarContexto(contexto, null),
    incluirConcluidas: todas === true,
  });
}

export async function concluir(db, { id, agora = Date.now() }) {
  return repo.concluirTarefa(db, { id: validarId(id), agora });
}

export async function excluir(db, { id }) {
  return repo.excluirTarefa(db, { id: validarId(id) });
}
