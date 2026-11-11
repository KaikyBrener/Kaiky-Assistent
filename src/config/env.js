// Lê e valida as variáveis de ambiente que o Worker precisa.
// Centralizar isso evita espalhar `env.ALGUMA_COISA` pelo código todo
// e permite falhar cedo, com uma mensagem clara, se algo estiver faltando.

const HEX_PUBLIC_KEY = /^[0-9a-f]{64}$/i; // chave Ed25519 = 32 bytes = 64 caracteres hex
const SNOWFLAKE = /^\d{17,20}$/; // IDs do Discord são números de 17 a 20 dígitos

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * @param {Record<string, unknown>} env Objeto `env` recebido pelo Worker.
 * @returns {{ publicKey: string, ownerId: string | null, appName: string }}
 */
export function getConfig(env) {
  const publicKey = String(env.DISCORD_PUBLIC_KEY ?? '').trim();
  if (!HEX_PUBLIC_KEY.test(publicKey)) {
    throw new ConfigError(
      'DISCORD_PUBLIC_KEY ausente ou inválida (esperado: 64 caracteres hexadecimais).',
    );
  }

  const rawOwner = String(env.OWNER_ID ?? '').trim();
  // Sem OWNER_ID válido, ninguém é considerado proprietário (falha fechada).
  const ownerId = SNOWFLAKE.test(rawOwner) ? rawOwner : null;

  return {
    publicKey,
    ownerId,
    appName: String(env.APP_NAME ?? 'Kaiky Assistant'),
  };
}
