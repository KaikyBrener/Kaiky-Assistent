// Ferramentas de TESTE: geram um par de chaves Ed25519 e assinam requisições
// do mesmo jeito que o Discord faz. Assim conseguimos testar o endpoint sem
// depender do Discord. Nunca use estas chaves em produção.

const encoder = new TextEncoder();

export function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

/** Gera um par de chaves e devolve a chave pública em hex (formato do Discord). */
export async function generateTestKeys() {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPublic = await crypto.subtle.exportKey('raw', keys.publicKey);
  return { privateKey: keys.privateKey, publicKeyHex: bytesToHex(new Uint8Array(rawPublic)) };
}

/** Assina timestamp + corpo e devolve os cabeçalhos que o Discord enviaria. */
export async function signBody(privateKey, body, timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(timestamp + body));
  return {
    'Content-Type': 'application/json',
    'X-Signature-Ed25519': bytesToHex(new Uint8Array(signature)),
    'X-Signature-Timestamp': timestamp,
  };
}

/** Cria um snowflake (ID do Discord) correspondente a "agora". */
export function snowflakeNow() {
  return String((BigInt(Date.now()) - 1420070400000n) << 22n);
}

export function pingInteraction() {
  return { id: snowflakeNow(), type: 1, application_id: '1', token: 'teste', version: 1 };
}

export function commandInteraction(name, userId = '111111111111111111', { inGuild = true } = {}) {
  const user = { id: userId, username: 'teste' };
  return {
    id: snowflakeNow(),
    type: 2,
    application_id: '1',
    token: 'teste',
    version: 1,
    data: { id: '2', name, type: 1 },
    ...(inGuild ? { guild_id: '3', member: { user } } : { user }),
  };
}
