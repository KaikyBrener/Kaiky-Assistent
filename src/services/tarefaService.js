// Regras de negócio das tarefas: validação de entrada + chamada ao banco.
//
// Por que validar aqui se o Discord já limita o tamanho do texto? Porque o
// Discord valida só no aplicativo dele. A regra de ouro é: nunca confie na
// entrada; confira tudo no servidor.

import * as repo from '../database/tarefasRepository.js';
import { parsePrazo } from './dateTime.js';

export const TITULO_MAX = 200;
export const TEXTO_LONGO_MAX = 4000;
export const CONTEXTOS = Object.freeze(['pessoal', 'profissional']);
export const TIPOS = Object.freeze(['tarefa', 'melhoria', 'estudo', 'reuniao']);

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

export function validarTipo(valor) {
  if (valor === undefined || valor === null) return 'tarefa';
  if (!TIPOS.includes(valor)) throw new ValidationError(`Tipo deve ser: ${TIPOS.join(', ')}.`);
  return valor;
}

/**
 * Texto longo de várias linhas (descrições, causa, solução).
 * Mantém as quebras de linha, tira espaços sobrando no fim.
 * Vazio → null (apaga o campo).
 */
export function validarTextoLongo(valor, nome = 'O texto', max = TEXTO_LONGO_MAX) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ValidationError(`${nome} é inválido.`);
  const texto = valor.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
  if (!texto) return null;
  if (texto.length > max) throw new ValidationError(`${nome} pode ter no máximo ${max} caracteres.`);
  return texto;
}

export function validarId(valor) {
  if (!Number.isSafeInteger(valor) || valor < 1) throw new ValidationError('Informe um número de tarefa válido.');
  return valor;
}

const UM_MINUTO = 60 * 1000;
const PRAZO_MAX_ANOS = 5;

/**
 * Prazo opcional, digitado no horário de Brasília.
 * Sem valor → null (tarefa sem prazo). Prazo no passado é recusado.
 */
export function validarPrazo(valor, agora = Date.now()) {
  if (valor === undefined || valor === null || valor === '') return null;
  const prazo = parsePrazo(valor);
  if (prazo === null) {
    throw new ValidationError('Prazo inválido. Use DD/MM/AAAA HH:MM (ex.: 15/11/2026 14:30) ou só DD/MM/AAAA.');
  }
  if (prazo < agora - UM_MINUTO) throw new ValidationError('Esse prazo já passou.');
  if (prazo > agora + PRAZO_MAX_ANOS * 365 * 24 * 60 * UM_MINUTO) {
    throw new ValidationError(`O prazo pode ser de no máximo ${PRAZO_MAX_ANOS} anos.`);
  }
  return prazo;
}

export async function criar(db, { titulo, contexto, prazo, tipo, interactionId, agora = Date.now() }) {
  if (typeof interactionId !== 'string' || !interactionId) throw new ValidationError('Interação sem ID.');
  return repo.criarTarefa(db, {
    titulo: validarTitulo(titulo),
    contexto: validarContexto(contexto),
    prazo: validarPrazo(prazo, agora),
    tipo: validarTipo(tipo),
    interactionId,
    agora,
  });
}

export async function obter(db, { id }) {
  return repo.obterTarefa(db, { id: validarId(id) });
}

export async function descrever(db, { id, descricao }) {
  return repo.atualizarDescricao(db, {
    id: validarId(id),
    descricao: validarTextoLongo(descricao, 'A descrição'),
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
