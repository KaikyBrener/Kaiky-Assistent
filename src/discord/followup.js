// Edita a resposta original de uma interação (usado pelos comandos adiados).
//
// Endpoint: PATCH /webhooks/{application_id}/{interaction_token}/messages/@original
// Docs: https://docs.discord.com/developers/interactions/receiving-and-responding
//
// Não precisa do token do bot: o próprio token da interação autoriza a edição.
// Esse token vale 15 minutos e funciona como senha. Por isso:
//   - ele nunca é registrado em log;
//   - a URL (que contém o token) nunca é registrada em log.
// Estes endpoints NÃO contam para o limite global de 50 req/s do bot.

const API_BASE = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{17,20}$/;
const INTERACTION_TOKEN = /^[A-Za-z0-9._-]{1,500}$/;

/** Espera máxima aceitável para tentar de novo após um 429 (rate limit). */
const MAX_RETRY_WAIT_SECONDS = 5;

/**
 * Se o comando terminar muito rápido, a edição pode chegar ao Discord ANTES
 * de ele terminar de processar a resposta "pensando..." (type 5). Nesse caso
 * ele devolve 404. Esperamos 1 s e tentamos uma única vez de novo.
 */
const NOT_READY_RETRY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Não usamos o corpo da resposta; descartá-lo (se ainda não foi lido) libera a conexão. */
async function discardBody(response) {
  if (response.body && !response.bodyUsed) await response.body.cancel();
}

/**
 * Decide se vale tentar de novo, e depois de quanto tempo.
 * - 404: a mensagem original ainda não existe → 1 s.
 * - 429: lê `retry_after` (segundos) da resposta, sem fixar limites no código.
 * @returns {number | null} milissegundos a esperar, ou null para não tentar de novo.
 */
export function retryDelayMs(status, body) {
  if (status === 404) return NOT_READY_RETRY_MS;
  if (status !== 429) return null;
  const seconds = Number(body?.retry_after);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_RETRY_WAIT_SECONDS) return null;
  return Math.ceil(seconds * 1000);
}

/**
 * @param {string} applicationId Vem de `interaction.application_id` (corpo assinado).
 * @param {string} interactionToken Vem de `interaction.token`.
 * @param {object} data Conteúdo da mensagem (ver messageData em responses.js).
 * @param {{ fetchImpl?: typeof fetch }} [options] `fetchImpl` permite simular nos testes.
 * @returns {Promise<{ ok: boolean, status: number }>}
 */
export async function editOriginalResponse(applicationId, interactionToken, data, { fetchImpl = fetch } = {}) {
  if (!SNOWFLAKE.test(String(applicationId)) || !INTERACTION_TOKEN.test(String(interactionToken))) {
    return { ok: false, status: 0 };
  }

  const url = `${API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  const init = {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };

  let response = await fetchImpl(url, init);
  if (response.status === 404 || response.status === 429) {
    const body = response.status === 429 ? await response.json().catch(() => null) : null;
    const wait = retryDelayMs(response.status, body);
    if (wait !== null) {
      await discardBody(response);
      await sleep(wait);
      response = await fetchImpl(url, init); // uma única nova tentativa
    }
  }
  await discardBody(response);
  return { ok: response.ok, status: response.status };
}
