# Kaiky Assistant

Assistente pessoal no Discord, hospedado de graça no **Cloudflare Workers**, usando **Discord Interactions via HTTP** (sem `client.login()`, sem Gateway, sem servidor ligado 24h).

**Status:** FASE 1 (Fundação) concluída: endpoint HTTP, validação Ed25519 e comando `/ping`.

---

## 1. Como funciona (em linguagem simples)

```
Você digita /ping no Discord
        │
        ▼
Discord faz um POST HTTPS para https://kaiky-assistant.<você>.workers.dev/
(com uma assinatura Ed25519 nos cabeçalhos)
        │
        ▼
Worker acorda ──► confere a assinatura ──► lê o JSON ──► acha o comando ──► responde
        │                 │ inválida
        │                 └──► 401 (recusa)
        ▼
Discord mostra "🏓 Pong!"
```

- **Por que HTTP e não discord.js com `client.login()`?** O `login()` precisa de um processo ligado o tempo todo, mantendo uma conexão WebSocket (Gateway). O Workers não funciona assim: ele só roda quando chega uma requisição. Com Interactions HTTP, o Discord é que chama a gente, então pagamos (zero) só pelo uso.
- **Por que validar a assinatura?** A URL é pública. Sem validar, qualquer pessoa poderia fingir ser o Discord. Além disso, o próprio Discord testa isso: ele manda assinaturas falsas de propósito e, se o endpoint aceitar, ele remove a URL.
- **Por que não usamos biblioteca para isso?** O Workers já tem `crypto.subtle` com Ed25519 nativo. Menos dependências = menos coisas para quebrar ou atualizar.

### Limites do plano gratuito (conferidos em 11/11/2026)

| Recurso | Free |
|---|---|
| Requisições | 100.000 por dia (zera à meia-noite UTC) |
| CPU por requisição | 10 ms (verificar uma assinatura usa bem menos) |
| Cron Triggers | 5 por **conta** (importante para a FASE 3) |
| Workers por conta | 100 |

Fonte: https://developers.cloudflare.com/workers/platform/limits/

---

## 2. Estrutura de pastas

```
kaiky-assistant/
├── src/
│   ├── index.js                  # Ponto de entrada: recebe HTTP, valida, encaminha
│   ├── config/
│   │   ├── constants.js          # Números da API do Discord com nome (PING=1, PONG=1...)
│   │   └── env.js                # Lê e valida variáveis/segredos
│   ├── discord/
│   │   ├── verifySignature.js    # Validação Ed25519
│   │   └── responses.js          # Monta respostas JSON (pong, reply)
│   ├── events/
│   │   └── interactionHandler.js # Roteia a interação + checa permissão + trata erros
│   ├── commands/
│   │   ├── index.js              # Lista única de comandos (usada pelo Worker e pelo registro)
│   │   └── central/ping.js       # /ping
│   ├── services/
│   │   └── authService.js        # Quem é o usuário? É o proprietário?
│   ├── database/                 # FASE 2 (D1)
│   └── jobs/                     # FASE 3 (Cron)
├── scripts/
│   ├── register-commands.js      # Envia a lista de comandos para o Discord
│   ├── smoke-test.js             # Teste local com o runtime real (wrangler dev)
│   └── lib/signing.js            # Gera chaves/assinaturas DE TESTE
├── test/worker.test.js           # Testes automatizados (node:test)
├── migrations/                   # FASE 2
├── wrangler.jsonc                # Configuração do Worker
├── .dev.vars.example             # Modelo dos segredos locais
└── .gitignore
```

**Regra de ouro:** cada comando é um arquivo que exporta `{ data, ownerOnly, execute }`. Para criar um novo, você cria o arquivo e adiciona uma linha em `src/commands/index.js`. Nada mais precisa mudar.

---

## 3. Rodando na sua máquina

Pré-requisitos: **Node.js 22 ou superior** e **Git**.

```bash
npm install          # instala só o Wrangler (única dependência, de desenvolvimento)
npm test             # 23 testes automatizados
npm run test:local   # sobe o Worker de verdade e manda requisições assinadas
```

O `test:local` gera uma chave de teste sozinho, então funciona mesmo antes de você configurar o Discord.

### Quando algo der errado

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| `npm test` diz "Cannot find module" | Node antigo | `node --version` precisa ser 22+ |
| Portal do Discord diz que a URL é inválida | Segredo `DISCORD_PUBLIC_KEY` errado ou ausente, ou Worker não publicado | Abra a URL no navegador (deve aparecer "online"); confira o segredo |
| "Servidor não configurado" (500) | Falta `DISCORD_PUBLIC_KEY` | `npx wrangler secret put DISCORD_PUBLIC_KEY` |
| `/ping` não aparece no Discord | Comandos não registrados | `npm run register` |
| "O aplicativo não respondeu" | Erro no código ou o Worker demorou mais de 3 s | `npx wrangler tail` mostra os logs ao vivo |

---

## 4. Publicando de graça (passo a passo)

### 4.1 Criar a aplicação no Discord
1. Acesse https://discord.com/developers/applications → **New Application** → nome "Kaiky Assistant".
2. Em **General Information**, copie o **Application ID** e a **Public Key**.
3. Em **Bot**, clique em **Reset Token** e copie o token. **Guarde: ele só aparece uma vez.** O token é como uma senha: não cole em chat, print ou commit.
4. Ative o **Modo Desenvolvedor** no seu Discord (Configurações → Avançado), clique com o botão direito no seu nome → **Copiar ID** (esse é o `OWNER_ID`). Faça o mesmo no seu servidor de testes (`DISCORD_GUILD_ID`).

### 4.2 Segredos locais
```bash
cp .dev.vars.example .dev.vars     # no Windows (PowerShell): Copy-Item .dev.vars.example .dev.vars
```
Preencha o `.dev.vars`. Ele já está no `.gitignore`.

### 4.3 Publicar o Worker
```bash
npx wrangler login        # abre o navegador para você autorizar (conta Cloudflare gratuita)
npm run deploy            # publica e mostra a URL https://kaiky-assistant.<você>.workers.dev
```
Na primeira vez, o Wrangler pode pedir para você escolher um subdomínio `workers.dev`. Nenhum DNS ou domínio seu é alterado.

### 4.4 Segredos em produção
```bash
npx wrangler secret put DISCORD_PUBLIC_KEY   # cole a Public Key quando pedir
npx wrangler secret put OWNER_ID             # cole o seu ID
```
O valor é digitado no prompt (não fica no histórico do terminal) e o Worker é republicado automaticamente.
O **token não vai para o Worker**: nesta fase, só o script de registro usa o token, na sua máquina.

### 4.5 Ligar o Discord ao Worker
1. Developer Portal → **General Information** → **Interactions Endpoint URL** → cole a URL do passo 4.3 → **Save**.
   O Discord manda um PING assinado na hora. Se salvar sem erro, a validação Ed25519 está funcionando em produção.
2. **OAuth2 → URL Generator**: marque o escopo `applications.commands`, abra a URL gerada e adicione o app ao seu servidor de testes.

### 4.6 Registrar o /ping
```bash
npm run register          # servidor de testes (aparece na hora)
# npm run register:global # opcional, depois: todos os servidores e DMs
```
Digite `/ping` no seu servidor. 🏓

### Logs em produção
```bash
npx wrangler tail
```

---

## 5. Segurança aplicada

- Assinatura Ed25519 conferida **antes** de ler o JSON; falhas → 401.
- Segredos fora do código (`.dev.vars` local, `wrangler secret` em produção); `.gitignore` cobre `.dev.vars*` e `.env*`.
- Comandos com `ownerOnly: true` só funcionam para o `OWNER_ID`. Sem `OWNER_ID` válido, ninguém passa (falha fechada).
- Erros internos são registrados no log; o usuário recebe só uma mensagem genérica.
- Respostas com `allowed_mentions: { parse: [] }`: o bot nunca marca @everyone por acidente.
- Corpo limitado a 64 KB; rotas e métodos desconhecidos → 404/405.

---

## 6. Próximas fases

- **FASE 2:** D1 + migrations + `/tarefa criar|listar|concluir|excluir`.
- **FASE 3:** Cron Trigger único (limite de 5 por conta) para lembretes e relatório diário.
- **FASE 4:** GitHub, e-mail próprio, painel, IA.

Documentação usada: [Discord Interactions](https://docs.discord.com/developers/interactions/overview) · [Receiving and Responding](https://docs.discord.com/developers/interactions/receiving-and-responding) · [Application Commands](https://docs.discord.com/developers/interactions/application-commands) · [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) · [Web Crypto no Workers](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) · [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
