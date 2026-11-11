-- Migration 0002: prazo nas tarefas + controle de notificações (FASE 3).

-- Prazo opcional: instante UTC em milissegundos. NULL = tarefa sem prazo.
ALTER TABLE tarefas ADD COLUMN prazo INTEGER;

-- Acelera a busca do Cron por tarefas pendentes com prazo.
CREATE INDEX idx_tarefas_pendentes_prazo ON tarefas (concluida, prazo);

-- Anti-duplicidade das notificações enviadas pelo Cron.
-- `chave` é única: 'lembrete:<id da tarefa>' ou 'relatorio:<AAAA-MM-DD>'.
-- O Cron RESERVA a chave antes de enviar; se outra execução já reservou,
-- o INSERT não faz nada e a mensagem não sai duas vezes.
CREATE TABLE notificacoes (
  chave       TEXT    PRIMARY KEY,
  tipo        TEXT    NOT NULL CHECK (tipo IN ('lembrete', 'relatorio')),
  tarefa_id   INTEGER,            -- só para lembretes
  status      TEXT    NOT NULL CHECK (status IN ('enviando', 'enviada')),
  criada_em   INTEGER NOT NULL,   -- quando a reserva foi feita (ms UTC)
  enviada_em  INTEGER             -- quando o Discord confirmou o envio
);
