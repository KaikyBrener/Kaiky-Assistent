-- Migration 0001: tabela de tarefas.
--
-- Migrations são "passos" numerados que levam o banco de um estado ao próximo.
-- O Wrangler guarda quais já rodaram (tabela d1_migrations), então cada
-- arquivo é aplicado UMA vez. Nunca edite uma migration já aplicada:
-- crie a próxima (0002_...) com a mudança.

CREATE TABLE tarefas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo                TEXT    NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  -- Separa a vida pessoal da profissional (requisito do projeto).
  contexto              TEXT    NOT NULL DEFAULT 'pessoal'
                                CHECK (contexto IN ('pessoal', 'profissional')),
  concluida             INTEGER NOT NULL DEFAULT 0 CHECK (concluida IN (0, 1)),
  criada_em             INTEGER NOT NULL,   -- milissegundos desde 1970 (Date.now())
  concluida_em          INTEGER,            -- NULL enquanto não concluída
  -- Anti-duplicidade: o ID da interação do Discord que criou a tarefa.
  -- UNIQUE garante que a mesma interação nunca crie duas tarefas.
  criada_por_interacao  TEXT    NOT NULL UNIQUE
);
