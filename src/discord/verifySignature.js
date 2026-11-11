// Validação da assinatura Ed25519 que o Discord coloca em toda requisição.
//
// Por que isso existe? Nosso endpoint é público na internet. Qualquer pessoa
// poderia mandar um POST fingindo ser o Discord. O Discord assina cada
// requisição com a chave PRIVADA dele; nós conferimos com a chave PÚBLICA
// da aplicação. Se a conta não fechar, recusamos com 401.
//
// O que é assinado: timestamp + corpo bruto (exatamente os bytes recebidos).
// Usamos a Web Crypto nativa do Workers (`crypto.subtle`) com o algoritmo
// "Ed25519" — sem bibliotecas externas.

const encoder = new TextEncoder();

/** Cache da chave importada: importar custa CPU, e a chave não muda. */
let cachedKey = null;
let cachedKeyHex = null;

/**
 * Converte texto hexadecimal ("a1b2...") em bytes.
 * Retorna null se o texto não for hex válido ou tiver tamanho diferente do esperado.
 */
export function hexToBytes(hex, expectedBytes) {
  if (typeof hex !== 'string' || hex.length !== expectedBytes * 2 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function getPublicKey(publicKeyHex) {
  if (cachedKey && cachedKeyHex === publicKeyHex) return cachedKey;
  const keyBytes = hexToBytes(publicKeyHex, 32);
  if (!keyBytes) throw new Error('Chave pública inválida.');
  cachedKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
  cachedKeyHex = publicKeyHex;
  return cachedKey;
}

/**
 * Lê o corpo da requisição e verifica a assinatura.
 * O corpo só pode ser lido uma vez, por isso devolvemos o texto junto.
 *
 * @param {Request} request
 * @param {string} publicKeyHex
 * @returns {Promise<{ isValid: boolean, body: string }>}
 */
export async function verifyDiscordRequest(request, publicKeyHex) {
  const signatureHex = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  const body = await request.text();

  if (!signatureHex || !timestamp) return { isValid: false, body };

  const signature = hexToBytes(signatureHex, 64); // assinatura Ed25519 = 64 bytes
  if (!signature) return { isValid: false, body };

  try {
    const key = await getPublicKey(publicKeyHex);
    const isValid = await crypto.subtle.verify(
      'Ed25519',
      key,
      signature,
      encoder.encode(timestamp + body),
    );
    return { isValid, body };
  } catch (error) {
    // Qualquer falha na verificação conta como assinatura inválida.
    console.error('Falha ao verificar assinatura:', error?.message);
    return { isValid: false, body };
  }
}
