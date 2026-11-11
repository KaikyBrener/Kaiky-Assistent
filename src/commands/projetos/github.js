// /github — consulta SOMENTE LEITURA ao seu GitHub pessoal.
//
// - Restrito ao proprietário (padrão "negado por padrão").
// - `deferred: true`: a API do GitHub pode demorar; respondemos "pensando..."
//   na hora e editamos a mensagem quando o resultado chegar (até 30 s).
// - Comandos adiados devolvem TEXTO (não um Response).

import { OptionType } from '../../config/constants.js';
import { readSubcommand } from '../../discord/options.js';
import { logger } from '../../services/logger.js';
import * as github from '../../services/githubService.js';

const handlers = {
  async repos(credenciais) {
    return github.formatarRepos(await github.listarRepos(credenciais));
  },
  async issues(credenciais, values) {
    const repo = values.repositorio?.trim() || undefined;
    return github.formatarIssues(await github.listarIssues({ ...credenciais, repo }), repo);
  },
  async atividade(credenciais) {
    return github.formatarAtividade(await github.listarAtividade(credenciais));
  },
};

export default {
  data: {
    name: 'github',
    description: 'Consulta seu GitHub pessoal (somente leitura).',
    options: [
      { type: OptionType.SUB_COMMAND, name: 'repos', description: 'Seus repositórios, do push mais recente.' },
      {
        type: OptionType.SUB_COMMAND,
        name: 'issues',
        description: 'Issues abertas (de um repositório ou dos mais recentes).',
        options: [
          {
            type: OptionType.STRING,
            name: 'repositorio',
            description: 'Opcional. Nome do repositório, ex.: Kaiky-Assistent.',
            max_length: 100,
          },
        ],
      },
      { type: OptionType.SUB_COMMAND, name: 'atividade', description: 'Sua atividade recente no GitHub.' },
    ],
  },
  deferred: true,
  ephemeral: true,

  async execute(interaction, { env }) {
    const sub = readSubcommand(interaction);
    const handler = sub && Object.hasOwn(handlers, sub.name) ? handlers[sub.name] : null;
    if (!handler) return 'Subcomando não reconhecido.';

    const credenciais = { token: env?.GITHUB_TOKEN, username: env?.GITHUB_USERNAME };
    try {
      return await handler(credenciais, sub.values);
    } catch (error) {
      if (!(error instanceof github.GitHubError)) throw error; // erro inesperado: o roteador registra e responde genérico
      // Só o TIPO do erro e o status vão para o log — nunca o token.
      logger.warn('github_error', { command: 'github', reason: error.kind, http_status: error.status });
      return github.mensagemDeErro(error);
    }
  },
};
