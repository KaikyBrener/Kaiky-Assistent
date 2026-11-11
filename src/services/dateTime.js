// Datas e horários no fuso de Brasília.
//
// Por que isso precisa de cuidado?
//  - O Cron da Cloudflare roda em UTC, e no banco guardamos instantes em UTC
//    (milissegundos desde 1970, o mesmo que Date.now()).
//  - Você digita e lê horários de Brasília.
// Então convertemos SEMPRE na borda: entrada do usuário → UTC; UTC → texto.
// Usamos Intl (embutido no JavaScript), sem bibliotecas, e sem fixar "-3h":
// se o Brasil voltar a ter horário de verão, o Intl já sabe.

export const TIMEZONE = 'America/Sao_Paulo';

const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Quebra um instante (ms UTC) nas partes do relógio de Brasília. */
export function localParts(ms) {
  const parts = {};
  for (const { type, value } of partsFormatter.formatToParts(new Date(ms))) parts[type] = value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday], // 0 = domingo
  };
}

/** Diferença (ms) entre o relógio de Brasília e UTC naquele instante (ex.: -3h). */
function offsetAt(ms) {
  const p = localParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Converte data/hora de Brasília em instante UTC (ms). */
export function fromLocal(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetAt(guess);
  // Segunda passada: corrige o caso raro de mudança de fuso no meio do caminho.
  result = guess - offsetAt(result);
  return result;
}

const PRAZO_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;

/**
 * Lê um prazo digitado: "15/11/2026 14:30" ou "15/11/2026" (vale até 23:59).
 * @returns {number | null} instante UTC em ms, ou null se o texto for inválido.
 */
export function parsePrazo(texto) {
  if (typeof texto !== 'string') return null;
  const match = texto.trim().match(PRAZO_REGEX);
  if (!match) return null;
  const [, d, m, y, h, min] = match;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  const hour = h === undefined ? 23 : Number(h);
  const minute = min === undefined ? 59 : Number(min);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null;

  const ms = fromLocal(year, month, day, hour, minute);
  // Confere a volta: 31/02 "vira" 03/03 e por isso é recusado.
  const back = localParts(ms);
  if (back.day !== day || back.month !== month || back.year !== year) return null;
  return ms;
}

const pad = (n) => String(n).padStart(2, '0');

/** "15/11/2026 14:30" no horário de Brasília. */
export function formatDateTime(ms) {
  const p = localParts(ms);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "15/11 14:30" — versão curta para listas. */
export function formatShort(ms) {
  const p = localParts(ms);
  return `${pad(p.day)}/${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "2026-11-15": chave do dia em Brasília (usada no anti-duplicidade do relatório). */
export function localDateKey(ms) {
  const p = localParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Instante UTC da meia-noite (Brasília) do dia de `ms`. */
export function startOfLocalDay(ms) {
  const p = localParts(ms);
  return fromLocal(p.year, p.month, p.day, 0, 0);
}

/** Instante UTC da meia-noite do dia SEGUINTE (fim exclusivo do dia). */
export function endOfLocalDay(ms) {
  const p = localParts(ms);
  // +36h a partir da meia-noite cai com folga no dia seguinte; depois normaliza.
  return startOfLocalDay(fromLocal(p.year, p.month, p.day, 12, 0) + DIA);
}

/** Segunda-feira 00:00 (Brasília) da semana de `ms`. */
export function startOfLocalWeek(ms) {
  const p = localParts(ms);
  const diasDesdeSegunda = (p.weekday + 6) % 7;
  return startOfLocalDay(fromLocal(p.year, p.month, p.day, 12, 0) - diasDesdeSegunda * DIA);
}

/** "em 45 min", "em 2 h", "há 10 min" — texto relativo simples. */
export function formatRelative(alvoMs, agoraMs) {
  const diff = alvoMs - agoraMs;
  const minutos = Math.round(Math.abs(diff) / MINUTO);
  const texto = minutos < 60 ? `${minutos} min` : `${Math.round(minutos / 60)} h`;
  return diff >= 0 ? `em ${texto}` : `há ${texto}`;
}
