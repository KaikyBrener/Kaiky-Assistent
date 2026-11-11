// Logs estruturados (JSON) com LISTA PERMITIDA de campos.
//
// Por que JSON? O Workers Logs indexa os campos de logs em JSON, então você
// consegue filtrar no painel por `command = "ping"` ou `outcome = "error"`.
//
// Por que lista permitida? O objeto da interação traz um `token` que funciona
// como senha por 15 minutos (permite editar as respostas do bot). Se alguém
// fizer `log({ ...interaction })` por engano, o token NÃO sai no log, porque
// só os campos abaixo são gravados.

const ALLOWED_FIELDS = new Set([
  'interaction_id',
  'interaction_type',
  'command',
  'outcome',
  'reason',
  'http_status',
  'deferred',
  'error_name',
  'error_message',
  'stack',
]);

const MAX_FIELD_LENGTH = 1000;

/** Monta a linha de log. Exportada para os testes. */
export function buildLogEntry(level, event, fields = {}) {
  const entry = { level, event };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null) continue;
    entry[key] = typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH) : value;
  }
  return entry;
}

function write(level, event, fields) {
  const line = JSON.stringify(buildLogEntry(level, event, fields));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};

/** Extrai de um erro só o que é útil e seguro de registrar. */
export function errorFields(error) {
  return {
    error_name: error?.name ?? 'Error',
    error_message: String(error?.message ?? error),
    stack: typeof error?.stack === 'string' ? error.stack : undefined,
  };
}
