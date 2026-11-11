// Validação da assinatura Ed25519 que o Discord coloca em toda requisição.
//
// Por que isso existe? Nosso endpoint é público na internet. Qualquer pessoa
// poderia mandar um POST fingindo ser o Discord. O Discord assina cada
// requisição com a chave PRIVADA dele; nós conferimos com a chave PÚBLICA
// da aplicação. Se a conta não fechar, recusamos com 401.
//
// O que é assinado: timestamp + corpo, exatamente os BYTES recebidos.
// Usamos a Web Crypto nativa do Workers (`crypto.subtle`) com o algoritmo
// "Ed25519": sem bibliotecas externas.

const encoder = new TextEncoder();

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

/** Junta os bytes do timestamp com os bytes do corpo: é isso que o Discord assina. */
function signedMessage(timestamp, bodyBytes) {
  const timestampBytes = encoder.encode(timestamp);
  const message = new Uint8Array(timestampBytes.byteLength + bodyBytes.byteLength);
  message.set(timestampBytes, 0);
  message.set(bodyBytes, timestampBytes.byteLength);
  return message;
}

/**
 * Verifica a assinatura de uma requisição do Discord.
 *
 * @param {Headers} headers Cabeçalhos da requisição.
 * @param {Uint8Array} bodyBytes Corpo exatamente como chegou (ver readBody.js).
 * @param {string} publicKeyHex Chave pública da aplicação (64 caracteres hex).
 * @returns {Promise<boolean>}
 */
export async function verifyDiscordSignature(headers, bodyBytes, publicKeyHex) {
  const signatureHex = headers.get('X-Signature-Ed25519');
  const timestamp = headers.get('X-Signature-Timestamp');
  if (!signatureHex || !timestamp) return false;

  const signature = hexToBytes(signatureHex, 64); // assinatura Ed25519 = 64 bytes
  const keyBytes = hexToBytes(publicKeyHex, 32); // chave pública Ed25519 = 32 bytes
  if (!signature || !keyBytes) return false;

  try {
    // Importar a chave custa microssegundos; por isso não guardamos cache em
    // variável global (estado global é compartilhado entre requisições).
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, signature, signedMessage(timestamp, bodyBytes));
  } catch {
    // Qualquer falha na verificação conta como assinatura inválida.
    return false;
  }
}
