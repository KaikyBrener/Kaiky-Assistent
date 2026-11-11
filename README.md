# Kaiky Assistant

Assistente pessoal no Discord, hospedado de graça no **Cloudflare Workers**, usando **Discord Interactions via HTTP** (sem `client.login()`, sem Gateway, sem servidor ligado 24h).

**Status:**
- **FASE 1 (Fundação):** concluída e validada no Discord real. Endpoint HTTP, validação Ed25519 e `/ping`.
- **Auditoria técnica:** aplicada. Ver [`docs/AUDITORIA.md`](docs/AUDITORIA.md).
- **FASE 2 (Banco de dados):** concluída e validada no Discord real. D1 e `/tarefa`, com anti-duplicidade.
- **FASE 3 (Automações):** prazo nas tarefas, lembretes e relatório diário às 08:00 no canal **#kaiky**, via Cron.
- **FASE 4 (Expansão):** `/ajuda`, `/painel` e `/github` (somente leitura).
- **Para ativar as FASES 3 e 4**, siga a [seção 7](#7-fases-3-e-4-ativar-automações-e-github).
- **Bugs, descrições longas e #dashboard:** `/bug`, tipo e descrição nas tarefas, e o canal #dashboard. Para ativar, siga a [seção 8](#8-bugs-descrições-e-dashboard-ativar).

---

## 1. Como funciona (em linguagem simples)

```
Você digita /ping no Discord
        │
        ▼
Discord faz um POST HTTPS para https://kaiky-assistant.<você>.workers.dev/
(com uma assinatura Ed25519 e um horário nos cabeçalhos)
        │
        ▼
Worker acorda ─► lê o corpo (máx. 64 KB) ─► confere horário e assinatura ─► lê o JSON ─► acha o comando ─► checa permissão ─► responde
                       │ grande demais              │ inválida
                       └─► 413                      └─► 401
        ▼
Discord mostra "🏓 Pong!"
```

- **Por que HTTP e não discord.js com `client.login()`?** O `login()` precisa de um processo ligado o tempo todo, mantendo uma conexão WebSocket (Gateway). O Workers não funciona assim: ele só roda quando chega uma requisição. Com Interactions HTTP é o Discord que chama a gente, então o custo (zero) é só pelo uso.
- **Por que validar a assinatura?** A URL é pública. Sem validar, qualquer pessoa poderia fingir ser o Discord. Além disso, o próprio Discord testa isso: ele manda assinaturas falsas de propósito e, se o endpoint aceitar, ele remove a URL.
- **Por que conferir o horário?** Uma requisição assinada continua válida para sempre se ninguém olhar a data. Recusamos as que estejam a mais de 5 minutos do relógio do Worker, o que impede reaproveitar uma requisição antiga.
- **Por que não usamos biblioteca para isso?** O Workers já tem `crypto.subtle` com Ed25519 nativo. Menos dependências significa menos coisas para quebrar ou atualizar.

### Limites do plano gratuito (conferidos em 11/11/2026)

| Recurso | Free |
|---|---|
| Requisições | 100.000 por dia (zera à meia-noite UTC) |
| CPU por requisição | 10 ms (verificar uma assinatura usa bem menos) |
| Cron Triggers | 5 por **conta** (importante para a FASE 3) |
| Logs + traces | 0,5 GB/dia, 7 dias de retenção, sem cobrança extra |
| `ctx.waitUntil()` | até 30 s depois da resposta |

Fontes: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Observability pricing](https://developers.cloudflare.com/observability/pricing/)

---

## 2. Estrutura de pastas

```
kaiky-assistant/
├── src/
│   ├── index.js                  # Ponto de entrada: recebe HTTP, valida, encaminha, registra log
│   ├── config/
│   │   ├── constants.js          # Números da API do Discord com nome (PING=1, PONG=1...)
│   │   └── env.js                # Lê e valida variáveis/segredos
│   ├── discord/
│   │   ├── readBody.js           # Lê o corpo com limite REAL de 64 KB
│   │   ├── verifySignature.js    # Ed25519 + janela de 5 minutos do timestamp
│   │   ├── responses.js          # Monta respostas (pong, reply, deferredReply)
│   │   └── followup.js           # Edita a resposta de um comando adiado
│   ├── events/
│   │   └── interactionHandler.js # Roteia, checa permissão, trata erros, adia comandos
│   ├── discord/options.js        # Lê subcomandos e opções preenchidas pelo usuário
│   ├── discord/webhook.js        # Envia/edita mensagens por webhook (#kaiky e #dashboard)
│   ├── discord/modal.js          # Formulários (modais) para textos longos
│   ├── commands/
│   │   ├── index.js              # Lista única de comandos (Worker + registro)
│   │   ├── central/ping.js       # /ping
│   │   ├── central/ajuda.js      # /ajuda (gerada a partir da lista de comandos)
│   │   ├── central/painel.js     # /painel
│   │   ├── tarefas/tarefa.js     # /tarefa criar|listar|concluir|excluir
│   │   ├── projetos/bug.js       # /bug registrar|resolver|reabrir|ver|listar|buscar
│   │   └── projetos/github.js    # /github repos|issues|atividade (somente leitura)
│   ├── services/
│   │   ├── authService.js        # Quem é o usuário? É o proprietário?
│   │   ├── logger.js             # Logs em JSON com lista permitida de campos
│   │   ├── tarefaService.js      # Regras e validação das tarefas (inclui prazo)
│   │   ├── tarefaFormat.js       # Como uma tarefa aparece no Discord
│   │   ├── dateTime.js           # Fuso America/Sao_Paulo (conversões de data)
│   │   ├── resumoService.js      # Textos do relatório, do painel e dos lembretes
│   │   ├── bugService.js         # Regras, validação e formatação dos bugs
│   │   └── githubService.js      # API do GitHub — só GET
│   ├── database/
│   │   ├── tarefasRepository.js       # SQL das tarefas (D1)
│   │   ├── notificacoesRepository.js  # Anti-duplicidade das notificações
│   │   ├── estatisticasRepository.js  # Números do relatório e do painel
│   │   ├── bugsRepository.js          # SQL dos bugs
│   │   └── estadoRepository.js        # Valores guardados entre execuções (ID do #dashboard)
│   └── jobs/
│       ├── index.js              # Chamado pelo Cron a cada 5 minutos
│       ├── lembretes.js          # Lembretes de prazo
│       ├── relatorioDiario.js    # Relatório das 08:00
│       └── dashboard.js          # Mensagem fixa do #dashboard
├── scripts/
│   ├── register-commands.js      # Envia os comandos ao Discord (com plano e confirmação)
│   └── lib/
│       ├── commandPlan.js        # Compara comandos do código × Discord
│       └── signing.js            # Gera chaves/assinaturas DE TESTE
├── test/
│   ├── *.test.js                 # Testes rápidos no Node (npm test)
│   ├── helpers/d1.js             # D1 local real para testes (getPlatformProxy)
│   └── runtime/*.runtime.js      # Testes no runtime real da Cloudflare (npm run test:runtime)
├── docs/
│   ├── AUDITORIA.md              # Achados da auditoria e correções
│   └── idempotencia-fase2.md     # Projeto anti-duplicidade para a FASE 2
├── migrations/
│   ├── 0001_criar_tarefas.sql            # Tabela de tarefas
│   ├── 0002_prazos_e_notificacoes.sql    # Prazo + controle de notificações
│   └── 0003_tipos_descricoes_bugs_dashboard.sql  # Tipo/descrição, bugs e estado
├── wrangler.jsonc                # Configuração do Worker
├── .dev.vars.example             # Modelo dos segredos locais
└── .gitignore
```

---

## 3. Criando um comando

Cada comando é um arquivo que exporta um objeto. Depois de criar o arquivo, adicione uma linha em `src/commands/index.js` e rode `npm run register`.

```js
export default {
  data: { name: 'exemplo', description: 'Descrição de 1 a 100 caracteres.' },
  // ownerOnly: false,   ← só para comandos INOFENSIVOS. Sem esta linha, o comando
  //                        é restrito ao proprietário (OWNER_ID). Isso é de propósito.
  async execute(interaction, context) {
    return reply('Olá!');            // comandos normais devolvem um Response
  },
};
```

**Segurança "negada por padrão":** se você esquecer o `ownerOnly`, o comando fica fechado, não aberto. Comandos restritos também são registrados com `default_member_permissions: "0"`, o que faz o Discord escondê-los de quem não é administrador. É uma camada extra; a checagem de verdade é feita no Worker.

### Comandos demorados (mais de 3 segundos)

O Discord dá **3 segundos** para a primeira resposta. Para algo mais lento (GitHub, IA...):

```js
export default {
  data: { name: 'relatorio', description: 'Gera um relatório.' },
  deferred: true,        // responde na hora com "pensando..."
  ephemeral: true,       // opcional: só você vê
  async execute(interaction, context) {
    const texto = await algoDemorado();
    return texto;        // comandos ADIADOS devolvem o TEXTO, não um Response
  },
};
```

Como funciona: o Worker responde na hora com `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`. O trabalho continua em `ctx.waitUntil()`, que dá até 30 s, e no fim a mensagem "pensando..." é editada com o resultado. Para um trabalho de mais de 30 s, será preciso outra arquitetura (fora do escopo atual).

---

## 4. Rodando na sua máquina

Pré-requisitos: **Node.js 22 ou superior** e **Git**.

```bash
npm install            # instala só o Wrangler (única dependência, de desenvolvimento)
npm test               # testes rápidos no Node.js (~3 s)
npm run test:runtime   # testes no runtime real da Cloudflare (workerd), via createTestHarness
npm run test:all       # tudo acima + validação do build (wrangler deploy --dry-run)
```

Os testes geram uma **chave de teste** a cada execução. Eles funcionam antes de você configurar o Discord e nunca usam seus segredos reais.

### Quando algo der errado

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| `npm test` diz "Cannot find module" | Node antigo | `node --version` precisa ser 22+ |
| `wrangler dev` avisa que falta um segredo | `.dev.vars` sem `DISCORD_PUBLIC_KEY` ou `OWNER_ID` | Preencha o `.dev.vars` |
| `wrangler deploy` falha com "required secrets" | Segredos de produção não configurados | Faça o passo 5.3 antes do deploy |
| Portal do Discord diz que a URL é inválida | Public Key errada, Worker não publicado ou relógio muito errado | Abra a URL no navegador (deve aparecer "online"); confira o segredo |
| `/ping` não aparece no Discord | Comandos não registrados | `npm run register` |
| "O aplicativo não respondeu" | Erro no código ou mais de 3 s | `npx wrangler tail` mostra os logs ao vivo; use `deferred: true` |
| Comando restrito responde "🔒" para você | `OWNER_ID` ausente ou errado | No log aparece `reason: owner_not_configured` ou `not_owner` |

---

## 5. Publicando de graça (passo a passo)

> Nada abaixo altera DNS ou domínio: o Worker usa só o subdomínio `workers.dev`.

### 5.1 Criar a aplicação no Discord
1. Acesse https://discord.com/developers/applications → **New Application** → nome "Kaiky Assistant".
2. Em **General Information**, copie o **Application ID** e a **Public Key**.
3. Em **Bot**, clique em **Reset Token** e copie o token. **Guarde: ele só aparece uma vez.** O token é como uma senha: não cole em chat, print ou commit.
4. Ative o **Modo Desenvolvedor** no seu Discord (Configurações → Avançado). Clique com o botão direito no seu nome → **Copiar ID**: esse é o `OWNER_ID`. Faça o mesmo no seu servidor de testes para obter o `DISCORD_GUILD_ID`.

### 5.2 Segredos locais
```bash
cp .dev.vars.example .dev.vars     # no Windows (PowerShell): Copy-Item .dev.vars.example .dev.vars
```
Preencha o `.dev.vars`. Ele já está no `.gitignore`.

O `wrangler.jsonc` declara `secrets.required`. Por isso o `wrangler dev` carrega do `.dev.vars` **só** `DISCORD_PUBLIC_KEY` e `OWNER_ID`. O `DISCORD_TOKEN` fica no mesmo arquivo, mas só é lido pelo script de registro; o Worker nunca recebe o token.

### 5.3 Login e segredos de produção (ANTES do deploy)
```bash
npx wrangler login                           # abre o navegador para você autorizar (conta gratuita)
npx wrangler secret put DISCORD_PUBLIC_KEY   # cole a Public Key quando pedir
npx wrangler secret put OWNER_ID             # cole o seu ID
```
- Se o Worker ainda não existe, o Wrangler pergunta se deve criá-lo. Responda **sim**.
- O valor é digitado no prompt, então não fica no histórico do terminal.
- Atenção: cada `secret put` publica uma nova versão na hora.

### 5.4 Publicar o Worker
```bash
npm run check     # opcional: valida o build sem publicar
npm run deploy    # publica e mostra a URL https://kaiky-assistant.<você>.workers.dev
```
Se faltar algum segredo do passo 5.3, o deploy para com um erro claro. Isso é de propósito.

### 5.5 Ligar o Discord ao Worker
1. Developer Portal → **General Information** → **Interactions Endpoint URL** → cole a URL do passo 5.4 → **Save**.
   O Discord manda um PING assinado na hora. Se salvar sem erro, a validação Ed25519 está funcionando em produção.
2. **OAuth2 → URL Generator**: marque o escopo `applications.commands`, abra a URL gerada e adicione o app ao seu servidor de testes.

### 5.6 Registrar os comandos
```bash
npm run register -- --dry-run   # mostra o que seria enviado (sem rede, sem token)
npm run register                # servidor de testes (aparece na hora)
```
O script primeiro **consulta** o que já está no Discord e mostra o plano (`+ criar`, `~ atualizar`, `- REMOVER`) antes de enviar.

#### ⚠️ Riscos do "bulk overwrite"
O registro usa `PUT .../commands`, que **substitui a lista inteira**:
- **Comando fora do código = comando apagado.** Se você tirar um comando do `src/commands/index.js` (ou rodar o script de uma versão antiga do projeto), ele some do Discord. Por isso o script **para** quando há remoções e só segue com `npm run register -- --yes`.
- **Global e servidor são listas separadas.** Registrar o mesmo comando nas duas faz ele aparecer **duplicado** no seu servidor de testes. Use o servidor para testar e o global só quando estiver pronto. Para tirar um comando do global, é preciso rodar o `register:global` com a lista nova.
- **Limite de criações:** 200 comandos novos por dia, por servidor. Atualizar um comando existente (mesmo nome) não conta como criação nova.
- **Rate limit:** um 429 é tratado com uma única espera (`retry_after`). Um 401 (token inválido) para na hora: insistir conta para o bloqueio temporário de IP do Discord (10.000 requisições inválidas a cada 10 min).

### Logs em produção
```bash
npx wrangler tail
```
Cada interação gera uma linha JSON, por exemplo:
`{"level":"info","event":"interaction","command":"ping","outcome":"ok","http_status":200,...}`
No painel da Cloudflare (Workers Logs) dá para filtrar por `command`, `outcome` ou `reason`. Os logs **nunca** contêm o token da interação nem dados do usuário.

---

## 6. FASE 2: ativar o banco D1

O código do `/tarefa` está pronto, mas o **banco real** precisa ser criado na **sua** conta Cloudflare. Faça na ordem: a migration roda **antes** do deploy, para a tabela já existir quando o código novo entrar no ar.

**6.1 Baixe o branch da FASE 2**
```powershell
git fetch
git checkout fase-2
npm install
```

**6.2 Crie o banco (gratuito)**
```powershell
npx wrangler d1 create kaiky-assistant-db
```
- Se o Wrangler perguntar se deve adicionar o banco à configuração ("add it on your behalf"), responda **não** (`n`). O `wrangler.jsonc` já tem o bloco pronto, e responder sim criaria um bloco duplicado.
- Copie o valor de `database_id` (um código no formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

**6.3 Cole o ID no `wrangler.jsonc`**
Troque `COLE_AQUI_O_ID_DO_SEU_BANCO` pelo ID copiado. Esse ID não é segredo e pode ir para o GitHub.

**6.4 Crie a tabela no banco real**
```powershell
npx wrangler d1 migrations apply kaiky-assistant-db --remote
```
Confirme com `y`. O Wrangler lista a migration `0001_criar_tarefas.sql` e faz um backup antes de aplicar.

**6.5 Teste, faça o commit e publique**
```powershell
npm run test:all
git add wrangler.jsonc
git commit -m "Configura o ID do banco D1"
git push
git checkout main
git merge fase-2
git push            # o deploy automático publica a FASE 2
```

**6.6 Registre o novo comando**
```powershell
npm run register
```
O plano deve mostrar `+ criar /tarefa 🔒` e `= sem mudança /ping`.

**6.7 Use no Discord**
```
/tarefa criar titulo:Estudar SQL contexto:pessoal
/tarefa listar
/tarefa concluir id:1
/tarefa excluir id:1
```
Todas as respostas são **efêmeras**: só você vê. Quem não for o proprietário recebe 🔒.

Se o `/tarefa` responder "Ocorreu um erro", o motivo mais provável é a migration não ter sido aplicada no banco remoto (passo 6.4). O log em `npx wrangler tail` mostra o detalhe (`command_failed`).

### Anti-duplicidade
Cada tarefa guarda o ID da interação do Discord que a criou, numa coluna `UNIQUE`. Se a mesma interação chegar duas vezes, o banco recusa a segunda inserção e o bot responde "esta solicitação já tinha sido processada". Detalhes em [`docs/idempotencia-fase2.md`](docs/idempotencia-fase2.md).

---

## 7. FASES 3 e 4: ativar automações e GitHub

O código está pronto e testado. Faltam **duas credenciais suas** e uma migration. Faça **nesta ordem**: o `wrangler.jsonc` exige os novos segredos, então o deploy falha de propósito se eles não existirem.

### 7.1 Webhook do canal #kaiky
1. No seu servidor, crie um canal de texto **privado** chamado `#kaiky`.
2. Abra **⚙️ Editar canal → Integrações → Webhooks → Novo webhook** e dê o nome "Kaiky Assistant".
3. Clique em **Copiar URL do webhook**. Ela começa com `https://discord.com/api/webhooks/...`.

**A URL é um segredo**: quem a tiver consegue postar no canal. Se ela vazar, apague o webhook e crie outro.

### 7.2 Token do GitHub (somente leitura)
Em github.com → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**:

| Campo | Valor |
|---|---|
| Token name | `kaiky-assistant` |
| Expiration | 90 dias (o `/github` avisa quando expirar) |
| Resource owner | **KaikyBrener** (sua conta pessoal) |
| Repository access | **All repositories** |
| Repository permissions → **Metadata** | **Read-only** (obrigatória; já vem marcada) |
| Repository permissions → **Issues** | **Read-only** |
| Account permissions → **Events** | **Read-only** (opcional: inclui atividade de repos privados) |
| Todo o resto | **No access** |

Não marque nenhuma permissão de escrita. Mesmo que marcasse, o código só faz requisições `GET`.

### 7.3 Segredos na Cloudflare (antes do merge)
```powershell
npx wrangler secret put DISCORD_WEBHOOK_URL   # cole a URL do webhook
npx wrangler secret put GITHUB_TOKEN          # cole o token do GitHub
npx wrangler secret list                      # devem aparecer 4 segredos
```

### 7.4 Migration 0002 no banco real
```powershell
git fetch
git checkout fase-3-4
npx wrangler d1 migrations apply kaiky-assistant-db --remote
```
Responda `y`. Deve aparecer ✅ ao lado de `0002_prazos_e_notificacoes.sql`.

### 7.5 Publicar e registrar
```powershell
git checkout main
git pull
git merge fase-3-4
git push            # deploy automático (inclui o Cron de 5 em 5 minutos)
npm run register    # depois que o deploy terminar
```
O plano do registro deve mostrar `+ criar` para `/ajuda`, `/painel` e `/github`, e `~ atualizar` para `/tarefa`, que ganhou a opção `prazo`.

A Cloudflare informa que mudanças no Cron podem levar **até 15 minutos** para valer.

### 7.6 Testar
```
/ajuda
/tarefa criar titulo:Teste de lembrete prazo:DD/MM/AAAA HH:MM   ← daqui a ~30 minutos
/painel
/github repos
/github issues
/github atividade
```
- O lembrete chega no `#kaiky` em até 5 minutos.
- O relatório chega todo dia a partir das 08:00.
- Os logs do Cron aparecem como `"event":"scheduled"` em `npx wrangler tail`.

### Como as automações funcionam
- **Cron:** roda `*/5 * * * *`, sempre em UTC. O código converte tudo para **America/Sao_Paulo**.
- **Lembrete:** sai quando falta até **1 hora** para o prazo, ou se a tarefa já venceu. Cada tarefa recebe **um** lembrete, e tarefas concluídas não recebem. Vários lembretes da mesma execução vão numa mensagem só.
- **Relatório diário:** sai na primeira execução a partir das **08:00**, uma vez por dia, com pendentes, atrasadas, as que vencem hoje e o resumo da semana. Sem pendências, a mensagem é "✅ Tudo em dia!".
- **Anti-duplicidade:** antes de enviar, o Cron **reserva** uma chave única na tabela `notificacoes` (`lembrete:<id>` ou `relatorio:<data>`).
  - Se outra execução já reservou, a mensagem não sai de novo.
  - Se o Discord falhar, a reserva é desfeita e a próxima execução tenta de novo.
  - Limite conhecido: se o Worker cair exatamente entre a reserva e o envio, aquele lembrete se perde. A escolha foi nunca duplicar.

---

## 8. Bugs, descrições e #dashboard: ativar

### 8.1 Migration 0003 no banco real (ANTES do merge)
O código novo usa as colunas `tipo` e `descricao` e as tabelas `bugs` e `estado`. Sem a migration, o `/tarefa` dá erro.
```powershell
git fetch
git checkout tarefas-detalhes-dashboard
npx wrangler d1 migrations apply kaiky-assistant-db --remote
```
Responda `y`. Deve aparecer ✅ ao lado de `0003_tipos_descricoes_bugs_dashboard.sql`.

### 8.2 Canal #dashboard (opcional)
1. Crie um canal de texto **privado** chamado `#dashboard`.
2. **⚙️ Editar canal → Integrações → Webhooks → Novo webhook → Copiar URL**.
3. Salve como segredo:
   ```powershell
   npx wrangler secret put DISCORD_DASHBOARD_WEBHOOK_URL
   ```

Esse segredo é **opcional**, de propósito: sem ele, o deploy funciona e o #dashboard só não é atualizado.

### 8.3 Publicar e registrar
```powershell
git checkout main
git pull
git merge tarefas-detalhes-dashboard
git push
npm run register      # depois que o deploy terminar
```
O plano deve mostrar `+ criar /bug` e `~ atualizar /tarefa`.

### Como usar
**Tarefa com descrição longa**
```
/tarefa criar titulo:Revisar PR 879 tipo:melhoria contexto:profissional descrever:True
```
- O formulário abre na hora. Cole o texto de várias linhas e clique em **Enviar**.
- `/tarefa ver id:N` mostra a tarefa completa.
- `/tarefa descrever id:N` edita a descrição (o formulário já vem preenchido).

**Documentar um bug**
```
/bug registrar sistema:Horus
```
- Abre um formulário com título, sistema, "o que acontece?" e "como reproduzir".
```
/bug resolver id:N
```
- Abre um formulário com causa, "como foi resolvido" (pode colar a descrição do PR) e PR/link.
- Os outros comandos:
  - `/bug ver id:N` mostra o problema e a resolução;
  - `/bug listar` lista os abertos;
  - `/bug listar status:resolvidos sistema:Horus` filtra por status e sistema;
  - `/bug buscar termo:col-xs` procura no texto de todos os bugs;
  - `/bug reabrir id:N` reabre um bug que voltou.

**#dashboard**
- Uma mensagem fixa com as tarefas pendentes (atrasadas primeiro) e os bugs abertos.
- O Cron **edita a mesma mensagem** a cada 5 minutos. Se você apagar a mensagem, ele cria outra.

Uma observação sobre dados de trabalho: bugs e descrições de PRs de sistemas da empresa ficam no **seu** D1 e no **seu** Discord. Confira se a política da empresa permite guardar esse tipo de informação fora dos sistemas dela.

---

## 9. Segurança aplicada

- O corpo é lido com **limite real de 64 KB** (stream), mesmo sem `Content-Length`. Acima disso: 413.
- Assinatura Ed25519 conferida sobre os **bytes exatos** recebidos, **antes** de interpretar o JSON. Falhas: 401.
- O timestamp precisa estar a até **5 minutos** do relógio do Worker (contra replay).
- Comandos são **restritos ao proprietário por padrão**. Sem `OWNER_ID` válido, ninguém passa (falha fechada).
- Segredos fora do código (`.dev.vars` local, `wrangler secret` em produção). `secrets.required` impede publicar sem eles.
- Logs em JSON com **lista permitida** de campos: o `token` da interação nunca é gravado.
- Erros internos ficam no log; o usuário recebe só uma mensagem genérica.
- Respostas com `allowed_mentions: { parse: [] }`: o bot nunca marca @everyone por acidente.
- Banco: valores do usuário entram só por `.bind(...)`, o que impede SQL injection (há teste com `DROP TABLE` no título). Título e ID são validados no servidor, e a mesma interação nunca cria duas tarefas.
- Notificações saem por um **webhook** (só posta em um canal). O token do bot nunca entra no Worker, e a URL do webhook nunca aparece em log.
- Formulários (modais) passam pelas mesmas regras dos comandos: assinatura, proprietário e validação. O `custom_id` é conferido por formato antes de qualquer ação.
- GitHub: token fine-grained **somente leitura**, e o código só faz `GET`. O token nunca aparece em logs, erros ou respostas. Nomes de repositório são validados antes de qualquer chamada.

**Risco conhecido:** a URL `workers.dev` é pública. Alguém poderia gastar a cota de 100 mil requisições/dia com chamadas inválidas. Mitigar isso exige regras de WAF num domínio próprio (ou seja, mexer em DNS), o que está fora do escopo. Detalhes em `docs/AUDITORIA.md`.

---

## 10. Próximas fases

- **FASE 2:** ✅ ativa.
- **FASE 3:** ✅ implementada (ativação: seção 7).
- **FASE 4:** ✅ `/ajuda`, `/painel` e `/github` implementados (ativação: seção 7).
- **Bugs, descrições e #dashboard:** ✅ implementados. Ative pela seção 8.
- **Futuro: IA (Workers AI).** Deixada para depois, como você decidiu. O `deferred: true` já está pronto para respostas demoradas.
- **Documentado, não implementado: e-mail em domínio próprio.** Receber ou enviar e-mail num domínio seu (pelo Email Routing da Cloudflare, por exemplo) exige configurar registros **MX/TXT no DNS** do domínio. Mexer em DNS está proibido neste projeto, então nada foi feito. Se um dia você quiser, o caminho é: um domínio **pessoal** (nunca o da empresa) → Email Routing → um handler `email` no Worker.

Documentação usada:
- Discord: [Interactions](https://docs.discord.com/developers/interactions/overview) · [Receiving and Responding](https://docs.discord.com/developers/interactions/receiving-and-responding) · [Application Commands](https://docs.discord.com/developers/interactions/application-commands)
- Cloudflare: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) · [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) · [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Test harness](https://developers.cloudflare.com/workers/testing/test-harness/) · [Traces](https://developers.cloudflare.com/workers/observability/traces/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- GitHub: [Repos](https://docs.github.com/en/rest/repos/repos) · [Issues](https://docs.github.com/en/rest/issues/issues) · [Events](https://docs.github.com/en/rest/activity/events)
