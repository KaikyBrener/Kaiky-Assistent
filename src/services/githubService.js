// Integração com o GitHub — SOMENTE LEITURA.
//
// Garantias deste módulo:
//  - Só existe a função `githubGet`, e ela usa o método GET fixo. Não há
//    código capaz de criar, alterar ou apagar nada (commits, issues, repos).
//  - O token vai apenas no cabeçalho Authorization. Ele nunca entra em logs,
//    mensagens de erro ou respostas ao Discord.
//  - O próprio token deve ter só permissões de leitura (ver README).
// Docs: https://docs.github.com/en/rest

import { escapeMarkdown } from './tarefaFormat.js';
import { formatShort } from './dateTime.js';

const API = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** Erro "conhecido" do GitHub, já traduzido para um tipo simples. */
export class GitHubError extends Error {
  constructor(kind, status) {
    super(`GitHub: ${kind}`);
    this.name = 'GitHubError';
    this.kind = kind; // token_invalido | sem_permissao | rate_limit | nao_encontrado | erro_api | nao_configurado | entrada_invalida
    this.status = status;
  }
}

export function validarRepo(nome) {
  if (typeof nome !== 'string' || !REPO.test(nome) || nome === '.' || nome === '..') {
    throw new GitHubError('entrada_invalida', 0);
  }
  return nome;
}

function validarCredenciais({ token, username }) {
  if (typeof token !== 'string' || !/^\S{10,}$/.test(token)) throw new GitHubError('nao_configurado', 0);
  if (typeof username !== 'string' || !USERNAME.test(username)) throw new GitHubError('nao_configurado', 0);
}

/** A ÚNICA forma deste projeto falar com o GitHub: GET, nada mais. */
async function githubGet(path, { token, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'kaiky-assistant', // o GitHub exige um User-Agent
    },
  });
  if (response.ok) return response.json();

  if (response.body && !response.bodyUsed) await response.body.cancel();
  const semCota = response.headers.get('x-ratelimit-remaining') === '0';
  if (response.status === 401) throw new GitHubError('token_invalido', 401);
  if (response.status === 429 || (response.status === 403 && semCota)) throw new GitHubError('rate_limit', response.status);
  if (response.status === 403) throw new GitHubError('sem_permissao', 403);
  if (response.status === 404) throw new GitHubError('nao_encontrado', 404);
  throw new GitHubError('erro_api', response.status);
}

/** Seus repositórios (dono = você), do push mais recente para o mais antigo. */
export async function listarRepos({ token, username, fetchImpl, porPagina = 10 }) {
  validarCredenciais({ token, username });
  const repos = await githubGet(`/user/repos?affiliation=owner&sort=pushed&per_page=${porPagina}`, { token, fetchImpl });
  return repos.map((r) => ({
    nome: r.name,
    privado: r.private === true,
    descricao: r.description ?? '',
    issuesAbertas: r.open_issues_count ?? 0, // atenção: o GitHub soma issues + PRs aqui
    ultimoPush: r.pushed_at ? Date.parse(r.pushed_at) : null,
  }));
}

function paraIssue(i, repo) {
  return { repo, numero: i.number, titulo: i.title ?? '', atualizada: Date.parse(i.updated_at) };
}

/**
 * Issues abertas. Com `repo`: só daquele repositório. Sem `repo`: dos até 5
 * repositórios mais recentes que têm algo aberto (limita as chamadas à API).
 * Pull requests são removidos (a API de issues também devolve PRs).
 */
export async function listarIssues({ token, username, repo, fetchImpl }) {
  validarCredenciais({ token, username });
  const buscar = async (nome) => {
    const issues = await githubGet(`/repos/${username}/${validarRepo(nome)}/issues?state=open&sort=updated&per_page=10`, {
      token,
      fetchImpl,
    });
    return issues.filter((i) => !i.pull_request).map((i) => paraIssue(i, nome));
  };

  if (repo) return buscar(repo);

  const comAlgoAberto = (await listarRepos({ token, username, fetchImpl, porPagina: 30 }))
    .filter((r) => r.issuesAbertas > 0)
    .slice(0, 5);
  const listas = await Promise.all(comAlgoAberto.map((r) => buscar(r.nome)));
  return listas.flat().sort((a, b) => b.atualizada - a.atualizada).slice(0, 15);
}

/** Descreve um evento do GitHub em português. */
export function descreverEvento(e) {
  const repo = escapeMarkdown(e.repo?.name ?? '?');
  const p = e.payload ?? {};
  switch (e.type) {
    case 'PushEvent': {
      const n = p.size ?? p.commits?.length;
      return `📤 push em ${repo}${Number.isInteger(n) ? ` (${n} commit${n === 1 ? '' : 's'})` : ''}`;
    }
    case 'CreateEvent':
      return `🆕 criou ${p.ref_type ?? 'item'}${p.ref ? ` ${escapeMarkdown(p.ref)}` : ''} em ${repo}`;
    case 'DeleteEvent':
      return `🗑️ apagou ${p.ref_type ?? 'item'}${p.ref ? ` ${escapeMarkdown(p.ref)}` : ''} em ${repo}`;
    case 'IssuesEvent':
      return `🐛 ${p.action ?? 'mexeu em'} issue #${p.issue?.number ?? '?'} em ${repo}`;
    case 'IssueCommentEvent':
      return `💬 comentou na issue #${p.issue?.number ?? '?'} em ${repo}`;
    case 'PullRequestEvent':
      return `🔀 ${p.action ?? 'mexeu em'} PR #${p.pull_request?.number ?? p.number ?? '?'} em ${repo}`;
    case 'WatchEvent':
      return `⭐ marcou ${repo} com estrela`;
    case 'ForkEvent':
      return `🍴 fez fork de ${repo}`;
    case 'ReleaseEvent':
      return `🏷️ release em ${repo}`;
    default:
      return `• ${escapeMarkdown(String(e.type ?? 'evento'))} em ${repo}`;
  }
}

/** Seus eventos recentes (públicos; privados também se o token tiver "Events: read"). */
export async function listarAtividade({ token, username, fetchImpl }) {
  validarCredenciais({ token, username });
  const eventos = await githubGet(`/users/${username}/events?per_page=10`, { token, fetchImpl });
  return eventos.map((e) => ({ descricao: descreverEvento(e), quando: Date.parse(e.created_at) }));
}

/** Formatações para o Discord. */
export function formatarRepos(repos) {
  if (repos.length === 0) return '📭 Nenhum repositório encontrado.';
  const linhas = repos.map((r) => {
    const cadeado = r.privado ? '🔒 ' : '';
    const push = r.ultimoPush ? ` · push ${formatShort(r.ultimoPush)}` : '';
    const desc = r.descricao ? ` — ${escapeMarkdown(r.descricao.slice(0, 80))}` : '';
    return `• ${cadeado}**${escapeMarkdown(r.nome)}**${push} · abertos: ${r.issuesAbertas}${desc}`;
  });
  return ['📚 **Seus repositórios** (último push primeiro):', ...linhas].join('\n');
}

export function formatarIssues(issues, repo) {
  const alvo = repo ? ` em ${escapeMarkdown(repo)}` : '';
  if (issues.length === 0) return `✅ Nenhuma issue aberta${alvo}.`;
  const linhas = issues.map(
    (i) => `• **${escapeMarkdown(i.repo)}#${i.numero}** · ${escapeMarkdown(i.titulo.slice(0, 120))} · ${formatShort(i.atualizada)}`,
  );
  return [`🐛 **Issues abertas${alvo}:**`, ...linhas].join('\n');
}

export function formatarAtividade(eventos) {
  if (eventos.length === 0) return '📭 Nenhuma atividade recente.';
  return ['🕒 **Atividade recente no GitHub:**', ...eventos.map((e) => `• ${e.descricao} · ${formatShort(e.quando)}`)].join('\n');
}

const MENSAGENS = {
  token_invalido: '🔑 O token do GitHub é inválido ou expirou. Gere um novo e atualize com `npx wrangler secret put GITHUB_TOKEN`.',
  sem_permissao: '🚫 O token não tem permissão para isso. Confira se ele tem **Metadata: Read** e **Issues: Read**.',
  rate_limit: '⏳ Limite de requisições do GitHub atingido. Tente de novo em alguns minutos.',
  nao_encontrado: '🔎 Não encontrei esse repositório (ou o token não tem acesso a ele).',
  erro_api: '⚠️ O GitHub respondeu com um erro. Tente de novo mais tarde.',
  nao_configurado: '⚙️ A integração com o GitHub não está configurada (GITHUB_TOKEN / GITHUB_USERNAME).',
  entrada_invalida: '⚠️ Nome de repositório inválido. Use só letras, números, ".", "-" e "_".',
};

export function mensagemDeErro(error) {
  return MENSAGENS[error?.kind] ?? MENSAGENS.erro_api;
}
