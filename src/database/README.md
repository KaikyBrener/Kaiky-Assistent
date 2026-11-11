# database

Camada de acesso ao **Cloudflare D1** (SQLite). Aqui fica **só SQL**: regras de negócio e validação ficam em `src/services/`.

| Arquivo | O que faz |
|---|---|
| `tarefasRepository.js` | Criar, listar, concluir e excluir tarefas |

A estrutura das tabelas é definida pelas migrations em `/migrations`, aplicadas pelo Wrangler:

```bash
npx wrangler d1 migrations apply kaiky-assistant-db --local    # banco local (wrangler dev)
npx wrangler d1 migrations apply kaiky-assistant-db --remote   # banco real na Cloudflare
```
