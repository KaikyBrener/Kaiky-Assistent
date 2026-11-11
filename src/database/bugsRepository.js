// SQL dos bugs (D1). Mesmas regras das tarefas: tudo por `.bind(...)`,
// uma instrução por operação, e anti-duplicidade pelo ID da interação.

export const COLUNAS_BUG =
  'id, titulo, sistema, descricao, como_reproduzir, causa, solucao, referencia, status, criado_em, resolvido_em';

/** Registra um bug. A mesma interação nunca cria dois (coluna UNIQUE). */
export async function criarBug(db, { titulo, sistema, descricao, comoReproduzir, interactionId, agora }) {
  const criado = await db
    .prepare(
      `INSERT INTO bugs (titulo, sistema, descricao, como_reproduzir, criado_em, criado_por_interacao)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (criado_por_interacao) DO NOTHING
       RETURNING ${COLUNAS_BUG}`,
    )
    .bind(titulo, sistema, descricao, comoReproduzir, agora, interactionId)
    .first();
  if (criado) return { bug: criado, repetido: false };
  const existente = await db
    .prepare(`SELECT ${COLUNAS_BUG} FROM bugs WHERE criado_por_interacao = ?`)
    .bind(interactionId)
    .first();
  return { bug: existente, repetido: true };
}

export async function obterBug(db, { id }) {
  return db.prepare(`SELECT ${COLUNAS_BUG} FROM bugs WHERE id = ?`).bind(id).first();
}

/**
 * Documenta a resolução. Pode ser chamado de novo para corrigir o texto:
 * a data da primeira resolução é mantida.
 */
export async function resolverBug(db, { id, causa, solucao, referencia, agora }) {
  return db
    .prepare(
      `UPDATE bugs
       SET causa = ?, solucao = ?, referencia = ?, status = 'resolvido',
           resolvido_em = COALESCE(resolvido_em, ?)
       WHERE id = ?
       RETURNING ${COLUNAS_BUG}`,
    )
    .bind(causa, solucao, referencia, agora, id)
    .first();
}

/** Volta o bug para "aberto" (ex.: o problema voltou). A documentação é mantida. */
export async function reabrirBug(db, { id }) {
  return db
    .prepare(`UPDATE bugs SET status = 'aberto', resolvido_em = NULL WHERE id = ? RETURNING ${COLUNAS_BUG}`)
    .bind(id)
    .first();
}

/** Lista com filtros opcionais. `status` null = todos. */
export async function listarBugs(db, { status = 'aberto', sistema = null, limite = 20 }) {
  const filtros = [];
  const valores = [];
  if (status) {
    filtros.push('status = ?');
    valores.push(status);
  }
  if (sistema) {
    filtros.push('sistema = ? COLLATE NOCASE'); // "horus" encontra "Horus"
    valores.push(sistema);
  }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const [lista, contagem] = await db.batch([
    db.prepare(`SELECT ${COLUNAS_BUG} FROM bugs ${where} ORDER BY status ASC, id DESC LIMIT ?`).bind(...valores, limite),
    db.prepare(`SELECT COUNT(*) AS total FROM bugs ${where}`).bind(...valores),
  ]);
  return { bugs: lista.results, total: contagem.results[0].total };
}

/** Escapa % e _ para que o termo seja procurado literalmente no LIKE. */
function padraoLike(termo) {
  return `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Busca o termo em título, sistema, descrição, causa, solução e referência. */
export async function buscarBugs(db, { termo, limite = 10 }) {
  const padrao = padraoLike(termo);
  const { results } = await db
    .prepare(
      `SELECT ${COLUNAS_BUG} FROM bugs
       WHERE titulo LIKE ?1 ESCAPE '\\' OR sistema LIKE ?1 ESCAPE '\\'
          OR descricao LIKE ?1 ESCAPE '\\' OR como_reproduzir LIKE ?1 ESCAPE '\\'
          OR causa LIKE ?1 ESCAPE '\\' OR solucao LIKE ?1 ESCAPE '\\' OR referencia LIKE ?1 ESCAPE '\\'
       ORDER BY id DESC LIMIT ?2`,
    )
    .bind(padrao, limite)
    .all();
  return results;
}
