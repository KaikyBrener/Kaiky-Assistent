// Pequenos valores guardados entre execuções do Cron (tabela `estado`).
// Hoje: o ID da mensagem fixa do #dashboard.

export async function obter(db, chave) {
  return db.prepare('SELECT chave, valor, atualizado_em FROM estado WHERE chave = ?').bind(chave).first();
}

/**
 * Reserva a chave (valor vazio) para criar algo UMA vez só.
 * @returns {Promise<boolean>} true se ESTA execução ficou com a reserva.
 */
export async function reservar(db, chave, agora) {
  const linha = await db
    .prepare('INSERT INTO estado (chave, valor, atualizado_em) VALUES (?, NULL, ?) ON CONFLICT (chave) DO NOTHING RETURNING chave')
    .bind(chave, agora)
    .first();
  return linha !== null;
}

export async function definir(db, chave, valor, agora) {
  await db
    .prepare(
      `INSERT INTO estado (chave, valor, atualizado_em) VALUES (?, ?, ?)
       ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
    )
    .bind(chave, valor, agora)
    .run();
}

export async function remover(db, chave) {
  await db.prepare('DELETE FROM estado WHERE chave = ?').bind(chave).run();
}
