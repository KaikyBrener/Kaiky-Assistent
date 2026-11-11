// Acesso ao banco D1: SÓ o SQL das tarefas mora aqui.
//
// Regras de segurança:
//  - Valores do usuário entram SEMPRE por `.bind(...)`, nunca concatenados no
//    texto do SQL. Isso impede SQL injection.
//  - Cada operação é UMA instrução: no SQLite, uma instrução é atômica
//    (acontece inteira ou não acontece).
//
// `db` é o binding D1 (env.DB), configurado no wrangler.jsonc.

const COLUNAS = 'id, titulo, contexto, concluida, criada_em, concluida_em';

/** Converte a linha do banco (0/1) para um objeto mais fácil de usar. */
function paraTarefa(linha) {
  if (!linha) return null;
  return { ...linha, concluida: linha.concluida === 1 };
}

/**
 * Cria uma tarefa. Se a mesma interação do Discord chegar de novo,
 * NÃO cria outra: devolve a tarefa já existente com `repetida: true`.
 */
export async function criarTarefa(db, { titulo, contexto, interactionId, agora }) {
  const criada = await db
    .prepare(
      `INSERT INTO tarefas (titulo, contexto, criada_em, criada_por_interacao)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (criada_por_interacao) DO NOTHING
       RETURNING ${COLUNAS}`,
    )
    .bind(titulo, contexto, agora, interactionId)
    .first();

  if (criada) return { tarefa: paraTarefa(criada), repetida: false };

  const existente = await db
    .prepare(`SELECT ${COLUNAS} FROM tarefas WHERE criada_por_interacao = ?`)
    .bind(interactionId)
    .first();
  return { tarefa: paraTarefa(existente), repetida: true };
}

/**
 * Lista tarefas. Pendentes primeiro (mais antigas no topo), depois concluídas.
 * @returns {Promise<{ tarefas: object[], total: number }>}
 */
export async function listarTarefas(db, { contexto = null, incluirConcluidas = false, limite = 20 }) {
  const filtros = [];
  const valores = [];
  if (contexto) {
    filtros.push('contexto = ?');
    valores.push(contexto);
  }
  if (!incluirConcluidas) filtros.push('concluida = 0');
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  // As duas consultas vão juntas num batch (uma ida ao banco).
  const [lista, contagem] = await db.batch([
    db
      .prepare(`SELECT ${COLUNAS} FROM tarefas ${where} ORDER BY concluida ASC, id ASC LIMIT ?`)
      .bind(...valores, limite),
    db.prepare(`SELECT COUNT(*) AS total FROM tarefas ${where}`).bind(...valores),
  ]);

  return { tarefas: lista.results.map(paraTarefa), total: contagem.results[0].total };
}

/**
 * Marca como concluída.
 * @returns {Promise<{ status: 'concluida' | 'ja_concluida' | 'nao_encontrada', tarefa: object | null }>}
 */
export async function concluirTarefa(db, { id, agora }) {
  const atualizada = await db
    .prepare(
      `UPDATE tarefas SET concluida = 1, concluida_em = ?
       WHERE id = ? AND concluida = 0
       RETURNING ${COLUNAS}`,
    )
    .bind(agora, id)
    .first();
  if (atualizada) return { status: 'concluida', tarefa: paraTarefa(atualizada) };

  // Não atualizou: ou não existe, ou já estava concluída.
  const existente = await db.prepare(`SELECT ${COLUNAS} FROM tarefas WHERE id = ?`).bind(id).first();
  return existente
    ? { status: 'ja_concluida', tarefa: paraTarefa(existente) }
    : { status: 'nao_encontrada', tarefa: null };
}

/** Exclui. @returns {Promise<object | null>} a tarefa excluída, ou null se não existia. */
export async function excluirTarefa(db, { id }) {
  const excluida = await db
    .prepare(`DELETE FROM tarefas WHERE id = ? RETURNING ${COLUNAS}`)
    .bind(id)
    .first();
  return paraTarefa(excluida);
}
