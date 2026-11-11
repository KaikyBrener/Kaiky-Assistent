# Auditoria técnica: Kaiky Assistant (FASE 1)

**Data:** 11/11/2026 · **Versão auditada:** commit `1526a2c` · **Wrangler:** 4.160.0 (o mais recente no npm na data)

**Referências usadas:**
- Cloudflare *workers-best-practices* e *wrangler* (cloudflare/skills).
- *discord-developers* (LevyBytes), conferida contra docs.discord.com.
- Método do *Claude Security*: só conta como achado o que tem um caminho concreto até o problema; "viola boa prática" sozinho não basta. A gravidade segue a escala CRÍTICO, ALTO, MÉDIO ou BAIXO, de acordo com o impacto e a dificuldade de explorar.

## Resumo

| Gravidade | Quantidade |
|---|---|
| Crítico | 0 |
| Alto | 0 |
| Médio | 6 |
| Baixo | 7 |

Nenhum achado permite a alguém se passar pelo Discord, executar comandos como proprietário ou ler segredos. A validação Ed25519 e a checagem `ownerOnly` estão corretas.

Os achados médios são de dois tipos:
- **Robustez:** limite de corpo contornável e falta de proteção contra repetição.
- **Riscos latentes para a FASE 2:** comandos públicos por padrão, sem suporte a respostas demoradas e sem logs úteis.

### Três comportamentos comprovados antes da correção

Rodei um script contra o código do commit `1526a2c`:

```
1 MB sem Content-Length -> status 401 | bytes lidos pelo Worker: 1048576
replay: 1ª -> 200 | 2ª (idêntica) -> 200
timestamp de 2 anos atrás -> 200
```

---

## Achados MÉDIOS

### M1. O limite de 64 KB pode ser contornado
- **Onde:** `src/index.js`, verificação de `Content-Length`; `src/discord/verifySignature.js`, `await request.text()`.
- **Problema:** o limite só olha o cabeçalho `Content-Length`. Uma requisição *chunked* (enviada em partes) chega sem esse cabeçalho, ou com um valor que não é número. Nesse caso `Number(...)` resulta em `0` ou `NaN` e a checagem passa. Em seguida, `request.text()` lê o corpo inteiro na memória **antes** de validar a assinatura.
- **Risco:** qualquer pessoa na internet, sem credencial nenhuma, faz o Worker carregar corpos muito maiores que 64 KB. O limite de memória é de 128 MB por isolate. Isso desperdiça memória e CPU e pode derrubar requisições legítimas que estejam rodando no mesmo isolate. O impacto é limitado: indisponibilidade temporária de um bot pessoal. Não há vazamento de dados.
- **Correção:** ler o corpo em *stream*, contando os bytes, e abortar com 413 ao passar de 64 KB. O cabeçalho continua sendo usado como atalho para recusar cedo.
- **Teste:** um corpo de 1 MB em stream sem `Content-Length` deve dar 413, e o Worker deve parar de ler logo depois de 64 KB. Um corpo pequeno continua funcionando. Verificar também no runtime real (workerd).

### M2. Sem validação temporal: uma requisição capturada vale para sempre
- **Onde:** `src/discord/verifySignature.js`.
- **Problema:** o Discord assina `timestamp + corpo`, mas o código não confere se esse timestamp é recente, nem se é um número.
- **Risco:** alguém que obtenha uma requisição assinada válida (num log vazado ou numa captura de tráfego) pode reenviá-la a qualquer momento. Obter essa requisição é difícil, porque o tráfego entre Discord e Cloudflare usa HTTPS; por isso não é ALTO. Hoje o impacto é nulo (`/ping`). Na FASE 2, isso significaria tarefas criadas em duplicidade.
- **Correção:** rejeitar timestamps que não sejam números inteiros e os que estejam a mais de **5 minutos** do relógio do Worker, para o passado ou para o futuro. A documentação do Discord não exige isso: é uma defesa extra. A janela de 5 minutos é larga o bastante para nunca recusar o Discord por diferença de relógio.
- **Teste:** assinatura válida com timestamp antigo dá 401; timestamp no futuro dá 401; timestamp não numérico dá 401; timestamp atual dá 200.

### M3. Sem proteção contra duplicidade (idempotência)
- **Onde:** projeto da FASE 2 (comandos que gravam no D1).
- **Problema:** dentro da janela de 5 minutos do M2, uma requisição repetida ainda seria processada duas vezes.
- **Risco:** registros duplicados no banco. Apareceria em `/tarefa criar` se a mesma requisição chegasse duas vezes.
- **Correção:** projeto descrito em [`docs/idempotencia-fase2.md`](idempotencia-fase2.md). Uma coluna `UNIQUE` guarda o `interaction.id` em toda tabela onde um comando cria registros, com `INSERT ... ON CONFLICT DO NOTHING`. Não há tabela extra nem limpeza programada. Só será implementado na FASE 2, junto com o D1.
- **Teste (FASE 2):** com o `createTestHarness` e o `applyD1Migrations`, enviar a mesma requisição assinada duas vezes e verificar que existe 1 linha.

### M4. Comandos são públicos por padrão
- **Onde:** `src/events/interactionHandler.js` (`if (command.ownerOnly && ...)`) e `src/commands/index.js`.
- **Problema:** um comando novo que esqueça `ownerOnly: true` fica aberto a qualquer pessoa no servidor. O `/ping` declara `ownerOnly: false` de forma explícita, então hoje não há exposição.
- **Risco:** na FASE 2, esquecer uma única linha expõe tarefas, estudos e anotações pessoais e profissionais.
- **Correção:** inverter o padrão para "negado, a menos que o comando declare `ownerOnly: false`". Como segunda camada, os comandos restritos passam a ser registrados com `default_member_permissions: "0"`. Esse é o valor documentado pelo Discord para esconder o comando de quem não é administrador. A checagem no Worker continua sendo a proteção principal.
- **Teste:** um comando sem a propriedade `ownerOnly` bloqueia quem não é dono e libera o dono. A definição de registro de comando restrito traz `default_member_permissions: "0"` e a de `/ping` não traz.

### M5. Sem suporte a respostas demoradas (limite de 3 s)
- **Onde:** `src/events/interactionHandler.js`.
- **Problema:** todo comando precisa responder dentro do próprio `fetch`. O Discord exige a resposta inicial em até 3 segundos.
- **Risco:** comandos planejados para a FASE 4 (GitHub, IA) vão passar de 3 s, e o Discord mostrará "O aplicativo não respondeu".
- **Correção:** suporte opcional a `deferred: true`. O Worker responde na hora com `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (type 5), que mostra "pensando...". O trabalho continua em `ctx.waitUntil()` e termina com `PATCH /webhooks/{application_id}/{token}/messages/@original`.
  - O `waitUntil` dá até 30 s depois da resposta.
  - O token da interação vale 15 min.
  - Não é preciso o token do bot.
  - O `application_id` vem no próprio payload assinado.
- **Teste:** com `fetch` simulado, o comando adiado devolve type 5 e depois um PATCH na URL correta com o conteúdo. Se o comando falhar, o PATCH leva uma mensagem genérica. O token não aparece em nenhum log.

### M6. Observabilidade insuficiente
- **Onde:** `wrangler.jsonc` (`observability`) e todos os `console.error`.
- **Problema:**
  - Os logs são texto solto, não JSON. A Cloudflare indexa campos só de logs em JSON.
  - Uma interação que dá certo não gera nenhum log, então não dá para saber que comando rodou nem com que resultado.
  - Os traces estão desligados. `observability.enabled` sozinho liga apenas os logs.
  - Não existe nenhuma regra que impeça um log futuro de despejar o objeto `interaction` inteiro, e esse objeto contém o `token` da interação, uma credencial válida por 15 min.
- **Risco:** depurar "não respondeu" em produção sem dados. Além disso, a chance de vazar o token num log.
- **Correção:**
  - Criar um logger pequeno que grava JSON e só aceita campos de uma lista permitida: o token nunca passa.
  - Gerar um log por interação com `interaction_id`, `type`, `command` e `outcome`.
  - Ligar `observability.logs` e `observability.traces`.
  - Plano gratuito: 0,5 GB/dia de ingestão compartilhada entre logs e traces, retenção de 7 dias, **sem cobrança adicional disponível**. Quando a cota acaba, o excedente não é cobrado.
- **Teste:** o logger descarta `token` e campos desconhecidos. Uma interação gera exatamente um log JSON válido.

---

## Achados BAIXOS

### B1. A assinatura é verificada sobre o texto decodificado, não sobre os bytes brutos
- **Onde:** `verifySignature.js`: `encoder.encode(timestamp + body)` depois de `request.text()`.
- **Problema:** bytes inválidos em UTF-8 são trocados por U+FFFD na decodificação. O conteúdo verificado deixa de ser exatamente o recebido.
- **Risco:** só pode causar falha segura (401). Não permite forjar nada. É uma questão de robustez.
- **Correção:** verificar `bytes(timestamp) + bytes(corpo)` e decodificar depois. Isso sai de graça com o M1.
- **Teste:** os testes de assinatura existentes continuam passando.

### B2. Estado mutável no nível do módulo (cache da chave)
- **Onde:** `verifySignature.js`: `let cachedKey` e `let cachedKeyHex`.
- **Problema:** é um anti-padrão listado pela Cloudflare, porque o isolate é reutilizado entre requisições.
- **Risco:** aqui o risco é baixo, porque o valor depende só do `env`, que é igual para todas as requisições, e não da requisição. Mesmo assim, é um padrão perigoso para um iniciante copiar, e o ganho é desprezível: importar uma chave Ed25519 custa microssegundos.
- **Correção:** remover o cache e importar a chave a cada requisição.
- **Teste:** os testes existentes de assinatura e do runtime.

### B3. Tratamento de erros incompleto no ponto de entrada
- **Onde:** `src/index.js`.
- **Problema:**
  - Uma falha ao ler o corpo (cliente desconectou) ou um erro de configuração que não seja `ConfigError` escapa sem log estruturado.
  - Um `execute` que devolva algo que não é `Response` gera erro do runtime.
- **Risco:** um 500 genérico da Cloudflare sem pista nos logs.
- **Correção:** um `try/catch` em volta de todo o `fetch`, com log JSON e um 500 limpo. Validar que `execute` devolveu um `Response`.
- **Teste:** um comando que devolve uma string recebe resposta amigável e gera log de erro. Uma falha inesperada dá 500 sem detalhes.

### B4. O script de registro não trata rate limit (429)
- **Onde:** `scripts/register-commands.js`.
- **Problema:** um 429 vira erro genérico.
- **Risco:**
  - Respostas 401, 403 e 429 contam para o limite de **10.000 requisições inválidas a cada 10 minutos**. Passar disso gera um bloqueio temporário de IP pelo Discord (difícil de atingir manualmente).
  - A criação de comandos tem limite de **200 por dia, por servidor**.
- **Correção:** em caso de 429, ler `retry_after` e tentar **uma** vez de novo, se a espera for curta. Num 401, parar imediatamente (não insistir com um token inválido). Não fixar limites no código: ler as respostas do Discord.
- **Teste:** uma função pura de decisão de nova tentativa, com testes unitários.

### B5. O bulk overwrite pode apagar comandos sem aviso
- **Onde:** `scripts/register-commands.js` (`PUT .../commands`).
- **Problema:** o `PUT` **substitui** a lista inteira. Rodar o script com a lista incompleta apaga comandos.
- **Risco operacional (documentado no README):**
  - Comandos somem sem aviso.
  - Registrar o mesmo comando como global **e** de servidor faz ele aparecer duplicado naquele servidor.
  - Comandos novos contam para o limite de criações diárias.
  - O global e o de servidor são listas separadas: rodar um não limpa o outro.
- **Correção:** antes do `PUT`, o script faz um `GET` da lista atual e mostra o plano (criar, atualizar, remover). Se houver remoções, ele só continua com `--yes`. Também valida o formato dos IDs.
- **Teste:** a função pura `planCommandChanges` com casos de criar, atualizar e remover.

### B6. Wrangler: segredos obrigatórios não declarados
- **Onde:** `wrangler.jsonc`.
- **Problema:** a versão 4.160 aceita `secrets.required` (conferido no schema instalado), e o projeto não declara. Sem `DISCORD_PUBLIC_KEY`, o `wrangler dev` sobe sem nenhum aviso.
- **Correção:** declarar `"secrets": { "required": ["DISCORD_PUBLIC_KEY", "OWNER_ID"] }`.
- **Conferido e OK, sem mudança:**
  - `compatibility_date` 2026-11-01 está suportada (o workerd local suporta até 2026-11-10).
  - Wrangler 4.160.0 é a versão mais recente.
  - `nodejs_compat` não é necessário: o código não usa módulos `node:*`.
  - `workers_dev: true` e nenhuma rota, então não há DNS envolvido.
- **Teste:** `wrangler deploy --dry-run` continua válido.

### B7. O token do bot fica disponível ao Worker local
- **Onde:** `.dev.vars.example` e `scripts/register-commands.js`.
- **Problema:** o `wrangler dev` injeta **todas** as variáveis do `.dev.vars` no Worker local, inclusive o `DISCORD_TOKEN`, que o Worker não usa.
- **Risco:** é só local, e o Worker não lê esse valor. Mesmo assim, contraria o princípio do menor privilégio.
- **Correção:** documentar o motivo e manter um único arquivo, para não complicar o iniciante. O token nunca vai para produção (não existe `secret put` dele), nunca vai para argumentos de linha de comando e nunca é impresso. Reavaliar se o Worker passar a ter acesso a outras credenciais.
- **Teste:** nenhum código muda.

---

## Itens conferidos sem problema

- **Ed25519:**
  - Usa `crypto.subtle.verify("Ed25519")`, nativo e com comparação em tempo constante.
  - Confere o tamanho exato da chave (32 bytes) e da assinatura (64 bytes) e valida o formato hexadecimal.
  - A verificação acontece **antes** de interpretar o JSON.
  - Qualquer exceção conta como assinatura inválida.
  - Responde 401 às assinaturas inválidas que o Discord envia de propósito como teste.
- **ownerOnly:** o ID vem de `member.user.id` ou `user.id`, dentro do corpo assinado, então não pode ser forjado. Sem `OWNER_ID` válido, a checagem fica fechada para todos. Comparar IDs com `===` é adequado, porque IDs do Discord são públicos e não são segredos.
- **Tempo de resposta:** o `/ping` responde em milissegundos. A verificação Ed25519 consome bem menos que os 10 ms de CPU do plano gratuito.
- **Rate limit das respostas:** responder a interações e usar os webhooks de interação **não** conta para o limite global de 50 req/s do bot.
- **Segredos:** nada fixado no código; o `.gitignore` cobre `.dev.vars*` e `.env*`; o token nunca é impresso.
- **Organização dos módulos:** a estrutura está boa. Nenhuma refatoração é necessária; só arquivos novos onde a função é nova.
- **Outros:** não há `Math.random()` no Worker, não há `ctx` desestruturado e não há promessas soltas.

## Risco residual (não corrigível sem mudar a infraestrutura)

O endpoint `workers.dev` é público. Alguém pode gastar as **100.000 requisições/dia** do plano gratuito com chamadas sem assinatura (cada uma recebe 401 rápido, mas conta). Quando isso acontece, a Cloudflare responde com o erro 1027 até a meia-noite UTC. Para mitigar, seria preciso regras de WAF ou rate limiting num domínio próprio, o que exige mexer em DNS, e você proibiu isso. Fica registrado.

## Testes: avaliação Vitest × createTestHarness

| Opção | Executa no workerd? | Dependências novas | Decisão |
|---|---|---|---|
| `node:test` (atual) | Não (Node) | Nenhuma | **Mantido** para funções puras (rápido e simples) |
| Script `smoke-test.js` (atual) | Sim | Nenhuma | **Substituído**: frágil (já deixou processos órfãos), sem relatório de teste padrão |
| `createTestHarness()` do Wrangler | Sim | **Nenhuma** (já vem no Wrangler 4.160) | **Adotado** para integração; oferece `applyD1Migrations()` para a FASE 2 |
| Integração Vitest da Cloudflare | Sim | Vitest + plugin | **Não adotado agora**: o `createTestHarness` cobre o runtime real sem novas dependências. Reavaliar só se surgir necessidade de testar módulos internos dentro do workerd |

## Sequência de correções (pequenas e independentes)

1. **Corpo:** limite real de 64 KB por stream e assinatura sobre bytes brutos, sem cache de módulo (M1, B1, B2).
2. **Timestamp:** formato e janela de 5 minutos (M2).
3. **Autorização:** negado por padrão e `default_member_permissions: "0"` (M4).
4. **Logs:** logger JSON com lista permitida, um log por interação, traces e `secrets.required` (M6, B6).
5. **Erros:** `try/catch` global e validação do retorno dos comandos (B3).
6. **Respostas adiadas:** `deferred: true`, `waitUntil` e PATCH em `@original` (M5).
7. **Registro:** plano com `GET`, confirmação `--yes`, 429/`retry_after` e validação de IDs (B4, B5).
8. **Testes de integração:** `createTestHarness` no lugar do `smoke-test.js` (item 11 da auditoria).
9. **Documentação:** README, riscos do bulk overwrite e projeto de idempotência (M3, B7).

Cada etapa vira um commit próprio, com os testes rodando antes do próximo.

---

## Estado após as correções

| Achado | Status | Commit | Evidência |
|---|---|---|---|
| M1 Limite de corpo | ✅ Corrigido | `c90bb76` | 1 MB sem Content-Length → 413 (Node e workerd) |
| M2 Timestamp | ✅ Corrigido | `68e9c07` | Assinatura válida de 2 anos atrás → 401 |
| M3 Idempotência | 📐 Projetado | — | [`idempotencia-fase2.md`](idempotencia-fase2.md); implementação na FASE 2 |
| M4 Negado por padrão | ✅ Corrigido | `f8f7d71` | Comando sem `ownerOnly` bloqueia estranhos |
| M5 Respostas adiadas | ✅ Implementado | `183261f` | type 5, depois PATCH em `@original` |
| M6 Observabilidade | ✅ Corrigido | `c8d82b6` | Log JSON por interação, sem token, também no workerd |
| B1 Bytes brutos | ✅ Corrigido | `c90bb76` | Teste com acentos e emoji |
| B2 Cache global | ✅ Removido | `c90bb76` | — |
| B3 Erros | ✅ Corrigido | `c8d82b6` | Falha ao ler o corpo → 500 limpo e log |
| B4 Rate limit do registro | ✅ Corrigido | `52939be` | `retry_after` e parada em 401 |
| B5 Bulk overwrite | ✅ Corrigido | `52939be` | Plano com GET e `--yes` para remoções |
| B6 `secrets.required` | ✅ Corrigido | `c8d82b6` | `deploy --dry-run` válido |
| B7 Token no Worker local | ✅ Resolvido de quebra | `c8d82b6` | Com `secrets.required`, o `wrangler dev` carrega só os segredos listados |

### O que os testes revelaram durante as correções

1. **Condição de corrida nos comandos adiados.** Se o trabalho termina muito rápido, a edição de `@original` pode chegar ao Discord antes de ele terminar de processar a resposta "pensando...", e ele responde 404. Correção: num 404, esperar 1 s e tentar **uma** vez de novo.
2. **Teste de 413 intermitente no workerd.** Quando o Worker responde 413 e para de ler, às vezes a conexão é encerrada antes de o cliente de teste ler a resposta. Isso é comportamento HTTP esperado, não defeito. O teste passou a conferir o que importa (o Worker registrou `body_too_large`) e ficou estável em 6 execuções seguidas.
3. **Teste antigo ajustado (M4).** O teste "erro dentro de um comando" usava um comando sem `ownerOnly` executado por um não proprietário. Com o novo padrão, ele seria bloqueado antes de chegar ao erro. O teste passou a rodar como proprietário e manteve o mesmo objetivo.

### Pendências

- **Validação contra o Discord real:** depende das suas credenciais (passos 5.1 a 5.6 do README). Isso inclui o fluxo adiado, testado com `fetch` simulado, mas não contra a API real.
- **M3 (idempotência):** implementar junto com o D1, na FASE 2.
- **Risco residual da cota diária:** exige WAF ou rate limiting num domínio próprio, fora do escopo.
