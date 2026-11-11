# Projeto: anti-duplicidade (idempotência) na FASE 2

> Status: ✅ **implementado** na FASE 2.
> - Código: `migrations/0001_criar_tarefas.sql` e `src/database/tarefasRepository.js`.
> - Teste: "a MESMA interação enviada duas vezes cria só UMA tarefa", em `test/runtime/tarefas.runtime.js`, roda no workerd com D1.
>
> A implementação seguiu o desenho abaixo, com nomes de colunas ajustados ao código final.

## O problema, em uma frase

Se a mesma interação chegar duas vezes, `/tarefa criar` não pode criar duas tarefas.

## Por que pode chegar duas vezes?

- **Replay:** alguém reenvia uma requisição assinada que conseguiu obter. A janela de 5 minutos (já implementada) limita isso, mas **dentro** da janela a requisição repetida ainda é válida.
- **Falhas de rede:** uma resposta perdida pode levar a um reenvio.

## A ideia: usar o `interaction.id`

Toda interação tem um `id` único, um *snowflake* do Discord. Ele vem dentro do corpo assinado, então não pode ser forjado. Se guardarmos esse `id` junto com o registro criado, o banco recusa sozinho a segunda tentativa.

## Desenho escolhido: coluna `UNIQUE` na própria tabela

```sql
-- migrations/0001_tarefas.sql (FASE 2)
CREATE TABLE tarefas (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo                 TEXT    NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  concluida              INTEGER NOT NULL DEFAULT 0,
  criada_em              INTEGER NOT NULL,
  -- ID da interação do Discord que criou esta linha.
  -- UNIQUE: a mesma interação nunca cria duas tarefas.
  criada_por_interacao   TEXT    NOT NULL UNIQUE
);
```

```js
// src/database/tarefas.js (FASE 2): uma única instrução, atômica.
const result = await env.DB.prepare(
  `INSERT INTO tarefas (titulo, criada_em, criada_por_interacao)
   VALUES (?, ?, ?)
   ON CONFLICT (criada_por_interacao) DO NOTHING
   RETURNING id`,
)
  .bind(titulo, Date.now(), interaction.id)
  .first();

if (result === null) {
  // Já existia: é uma repetição. Respondemos sem criar nada.
}
```

### Por que este desenho (e não uma tabela separada)?

| Opção | Prós | Contras |
|---|---|---|
| **Coluna `UNIQUE` na tabela que cria registros** (escolhida) | Uma instrução só, atômica; sem tabela extra; sem limpeza programada | Precisa repetir a coluna em cada tabela que recebe criações |
| Tabela `interacoes_processadas` | Serve para qualquer efeito colateral | Duas escritas por comando; precisa de transação; cresce para sempre (exige um Cron de limpeza, e só há 5 por conta) |

### E os outros comandos?

- `/tarefa concluir`: concluir duas vezes dá o mesmo resultado. Já é idempotente.
- `/tarefa excluir`: a segunda tentativa não encontra nada. Já é idempotente; responder "tarefa não encontrada" é aceitável.
- `/tarefa listar`: só leitura.

A tabela separada só será necessária na FASE 4, se surgir um efeito que não pode ser repetido e que não grava no banco (por exemplo, enviar um e-mail).

## Como testar (FASE 2)

Com o `createTestHarness`, que já é usado em `test/runtime/`:

```js
const worker = server.getWorker();
await worker.applyD1Migrations('DB');        // aplica as migrations no banco local de teste
const interacao = commandInteraction('tarefa'); // mesma interação...
await signed(interacao);                     // ...enviada
await signed(interacao);                     // ...duas vezes
const env = await worker.getEnv();
const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM tarefas').first();
assert.equal(total, 1);
```

## Limites do D1 no plano gratuito (conferidos em 11/11/2026)

- 10 bancos por conta.
- 500 MB por banco.
- 50 consultas por invocação do Worker.

Fonte: https://developers.cloudflare.com/d1/platform/limits/
