// Regras dos bugs: validação de entrada, chamadas ao banco e formatação.

import * as repo from '../database/bugsRepository.js';
import { ValidationError, validarTitulo, validarTextoLongo, validarId } from './tarefaService.js';
import { escapeMarkdown } from './tarefaFormat.js';
import { formatDateTime, formatShort } from './dateTime.js';

export const SISTEMA_MAX = 60;
export const REFERENCIA_MAX = 300;
export const STATUS_FILTRO = Object.freeze({ abertos: 'aberto', resolvidos: 'resolvido', todos: null });

export function validarSistema(valor) {
  if (typeof valor !== 'string') throw new ValidationError('Informe o sistema (ex.: Horus).');
  const sistema = valor.replace(/\s+/g, ' ').trim();
  if (!sistema) throw new ValidationError('O sistema não pode ficar vazio.');
  if (sistema.length > SISTEMA_MAX) throw new ValidationError(`O sistema pode ter no máximo ${SISTEMA_MAX} caracteres.`);
  return sistema;
}

/** PR, link ou commit: uma linha só. */
export function validarReferencia(valor) {
  if (valor === undefined || valor === null) return null;
  const ref = String(valor).replace(/\s+/g, ' ').trim();
  if (!ref) return null;
  if (ref.length > REFERENCIA_MAX) throw new ValidationError(`A referência pode ter no máximo ${REFERENCIA_MAX} caracteres.`);
  return ref;
}

export async function registrar(db, { titulo, sistema, descricao, comoReproduzir, interactionId, agora = Date.now() }) {
  if (typeof interactionId !== 'string' || !interactionId) throw new ValidationError('Interação sem ID.');
  const desc = validarTextoLongo(descricao, 'A descrição do problema');
  if (!desc) throw new ValidationError('Descreva o problema.');
  return repo.criarBug(db, {
    titulo: validarTitulo(titulo),
    sistema: validarSistema(sistema),
    descricao: desc,
    comoReproduzir: validarTextoLongo(comoReproduzir, '"Como reproduzir"'),
    interactionId,
    agora,
  });
}

export async function resolver(db, { id, causa, solucao, referencia, agora = Date.now() }) {
  const textoSolucao = validarTextoLongo(solucao, 'A solução');
  if (!textoSolucao) throw new ValidationError('Descreva como o bug foi resolvido.');
  return repo.resolverBug(db, {
    id: validarId(id),
    causa: validarTextoLongo(causa, 'A causa'),
    solucao: textoSolucao,
    referencia: validarReferencia(referencia),
    agora,
  });
}

export const obter = (db, { id }) => repo.obterBug(db, { id: validarId(id) });
export const reabrir = (db, { id }) => repo.reabrirBug(db, { id: validarId(id) });

export async function listar(db, { status = 'abertos', sistema }) {
  if (!Object.hasOwn(STATUS_FILTRO, status)) throw new ValidationError('Status deve ser abertos, resolvidos ou todos.');
  return repo.listarBugs(db, {
    status: STATUS_FILTRO[status],
    sistema: sistema === undefined || sistema === null || sistema === '' ? null : validarSistema(sistema),
  });
}

export async function buscar(db, { termo }) {
  const t = typeof termo === 'string' ? termo.trim() : '';
  if (t.length < 2 || t.length > 100) throw new ValidationError('O termo de busca deve ter de 2 a 100 caracteres.');
  return repo.buscarBugs(db, { termo: t });
}

// ---- Formatação ----

export function formatarBug(b) {
  const marcador = b.status === 'resolvido' ? '✅' : '🐛';
  const quando = b.status === 'resolvido' ? `resolvido ${formatShort(b.resolvido_em)}` : `aberto ${formatShort(b.criado_em)}`;
  return `${marcador} **#${b.id}** · ${escapeMarkdown(b.sistema)} · ${escapeMarkdown(b.titulo)} · ${quando}`;
}

const MAX_SECAO = 2800; // 2 cartões ≤ 6000 caracteres no total (limite do Discord)

function secoes(pares) {
  const partes = pares.filter(([, texto]) => texto).map(([titulo, texto]) => `**${titulo}**\n${texto}`);
  const texto = partes.join('\n\n');
  return texto.length > MAX_SECAO ? `${texto.slice(0, MAX_SECAO - 12)}\n… (cortado)` : texto;
}

/** Até 2 cartões: o problema e, se houver, a resolução. */
export function detalhesBug(b) {
  const cartoes = [
    {
      title: `🐛 #${b.id} · ${b.titulo}`,
      description: secoes([
        ['Problema', b.descricao],
        ['Como reproduzir', b.como_reproduzir],
      ]),
      fields: [
        { name: 'Sistema', value: b.sistema },
        { name: 'Status', value: b.status === 'resolvido' ? `✅ resolvido em ${formatDateTime(b.resolvido_em)}` : '🐛 aberto' },
        { name: 'Registrado em', value: formatDateTime(b.criado_em) },
      ],
    },
  ];
  if (b.solucao || b.causa) {
    cartoes.push({
      title: '✅ Como foi resolvido',
      description: secoes([
        ['Causa', b.causa],
        ['Solução', b.solucao],
      ]),
      fields: b.referencia ? [{ name: 'Referência (PR / link)', value: b.referencia }] : [],
    });
  } else {
    cartoes[0].fields.push({ name: 'Resolução', value: `Ainda não documentada. Use \`/bug resolver id:${b.id}\`.` });
  }
  return cartoes;
}
