-- Migration 0003: tipo e descrição nas tarefas, registro de bugs e estado do #dashboard.

-- Tipo da tarefa. Tarefas antigas ficam como 'tarefa'.
ALTER TABLE tarefas ADD COLUMN tipo TEXT NOT NULL DEFAULT 'tarefa'
  CHECK (tipo IN ('tarefa', 'melhoria', 'estudo', 'reuniao'));

-- Descrição longa (várias linhas), preenchida pelo formulário /tarefa descrever.
ALTER TABLE tarefas ADD COLUMN descricao TEXT
  CHECK (descricao IS NULL OR length(descricao) <= 4000);

-- Bugs: o que aconteceu, como reproduzir e, depois, como foi resolvido.
CREATE TABLE bugs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo                TEXT    NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  sistema               TEXT    NOT NULL CHECK (length(sistema) BETWEEN 1 AND 60),  -- ex.: Horus
  descricao             TEXT    CHECK (descricao IS NULL OR length(descricao) <= 4000),
  como_reproduzir       TEXT    CHECK (como_reproduzir IS NULL OR length(como_reproduzir) <= 4000),
  causa                 TEXT    CHECK (causa IS NULL OR length(causa) <= 4000),
  solucao               TEXT    CHECK (solucao IS NULL OR length(solucao) <= 4000),
  referencia            TEXT    CHECK (referencia IS NULL OR length(referencia) <= 300),  -- PR, link, commit
  status                TEXT    NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'resolvido')),
  criado_em             INTEGER NOT NULL,
  resolvido_em          INTEGER,
  -- Anti-duplicidade: a mesma interação do Discord nunca cria dois bugs.
  criado_por_interacao  TEXT    NOT NULL UNIQUE
);

CREATE INDEX idx_bugs_status_sistema ON bugs (status, sistema);

-- Pequenos valores guardados pelo Worker entre execuções do Cron.
-- Ex.: chave 'dashboard_message_id' = ID da mensagem fixa do #dashboard.
CREATE TABLE estado (
  chave          TEXT    PRIMARY KEY,
  valor          TEXT,
  atualizado_em  INTEGER NOT NULL
);
