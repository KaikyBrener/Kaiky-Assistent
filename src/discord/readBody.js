// Lê o corpo da requisição com um limite REAL de tamanho.
//
// Por que não basta olhar o cabeçalho Content-Length? Porque ele é opcional:
// uma requisição enviada em partes ("chunked") chega sem ele. Se usássemos
// `await request.text()`, o Worker carregaria o corpo inteiro na memória,
// fosse de 1 KB ou de 50 MB, antes de saber se a requisição é legítima.
//
// Aqui lemos pedaço por pedaço (stream), somando os bytes, e paramos assim
// que o limite é ultrapassado.

export class BodyTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Corpo maior que ${maxBytes} bytes.`);
    this.name = 'BodyTooLargeError';
  }
}

/**
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array>} Os bytes exatos que chegaram.
 */
export async function readBodyWithLimit(request, maxBytes) {
  // Atalho: se o cliente já declarou um tamanho grande, recusamos sem ler nada.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);

  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel(); // para de receber o resto
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  // Junta os pedaços num único bloco de bytes.
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
