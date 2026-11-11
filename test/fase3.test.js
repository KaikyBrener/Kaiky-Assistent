// Testes unitários da FASE 3: fuso horário, prazo e webhook (sem banco).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as dt from '../src/services/dateTime.js';
import { validarPrazo, ValidationError } from '../src/services/tarefaService.js';
import { isValidWebhookUrl, sendWebhookMessage } from '../src/discord/webhook.js';
import { formatarTarefa } from '../src/services/tarefaFormat.js';

const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${'a'.repeat(68)}`;

describe('Fuso America/Sao_Paulo', () => {
  test('converte horário de Brasília em UTC e volta', () => {
    const ms = dt.parsePrazo('15/11/2026 14:30');
    assert.equal(new Date(ms).toISOString(), '2026-11-15T17:30:00.000Z');
    assert.equal(dt.formatDateTime(ms), '15/11/2026 14:30');
  });

  test('só a data vale até 23:59 daquele dia', () => {
    assert.equal(dt.formatDateTime(dt.parsePrazo('15/11/2026')), '15/11/2026 23:59');
  });

  test('datas inválidas são recusadas', () => {
    for (const ruim of ['31/02/2026', '15/13/2026', '15/11/2026 24:00', '15/11/2026 10:60', '2026-11-15', 'amanhã', '']) {
      assert.equal(dt.parsePrazo(ruim), null, ruim);
    }
  });

  test('23:30 de Brasília ainda é "hoje" (em UTC já é o dia seguinte)', () => {
    const ms = Date.parse('2026-11-12T02:30:00Z'); // 11/11 23:30 em Brasília
    assert.equal(dt.localDateKey(ms), '2026-11-11');
    assert.equal(dt.localParts(ms).hour, 23);
  });

  test('início do dia e da semana (segunda 00:00)', () => {
    const quarta = dt.fromLocal(2026, 11, 11, 15, 0);
    assert.equal(dt.formatDateTime(dt.startOfLocalDay(quarta)), '11/11/2026 00:00');
    assert.equal(dt.formatDateTime(dt.endOfLocalDay(quarta)), '12/11/2026 00:00');
    assert.equal(dt.formatDateTime(dt.startOfLocalWeek(quarta)), '09/11/2026 00:00');
    const domingoNoite = dt.fromLocal(2026, 11, 15, 23, 0);
    assert.equal(dt.formatDateTime(dt.startOfLocalWeek(domingoNoite)), '09/11/2026 00:00');
  });
});

describe('Validação do prazo', () => {
  const agora = dt.fromLocal(2026, 11, 11, 12, 0);
  test('sem prazo → null (tarefa continua funcionando normalmente)', () => {
    assert.equal(validarPrazo(undefined, agora), null);
    assert.equal(validarPrazo('', agora), null);
  });
  test('prazo no passado ou mal escrito é recusado', () => {
    assert.throws(() => validarPrazo('10/11/2026 10:00', agora), /já passou/);
    assert.throws(() => validarPrazo('amanhã', agora), ValidationError);
    assert.throws(() => validarPrazo('11/11/2040', agora), /no máximo 5 anos/);
  });
  test('prazo futuro é aceito', () => {
    assert.equal(dt.formatDateTime(validarPrazo('12/11/2026 09:00', agora)), '12/11/2026 09:00');
  });
  test('tarefa atrasada aparece com aviso', () => {
    const t = { id: 1, titulo: 'X', contexto: 'pessoal', concluida: false, prazo: agora - 1 };
    assert.match(formatarTarefa(t, agora), /📅 11\/11 11:59 · ⚠️ atrasada/);
    assert.doesNotMatch(formatarTarefa({ ...t, concluida: true }, agora), /atrasada/);
  });
});

describe('Webhook do Discord', () => {
  test('só aceita URLs de webhook do Discord', () => {
    assert.equal(isValidWebhookUrl(WEBHOOK), true);
    assert.equal(isValidWebhookUrl(WEBHOOK.replace('https', 'http')), false);
    assert.equal(isValidWebhookUrl('https://evil.com/api/webhooks/123456789012345678/abc'), false);
    assert.equal(isValidWebhookUrl('https://discord.com.evil.com/api/webhooks/1/abc'), false);
    assert.equal(isValidWebhookUrl(undefined), false);
  });

  test('envia com wait=true, sem menções, e não chama a rede se a URL for inválida', async () => {
    const chamadas = [];
    const fetchImpl = async (url, init) => {
      chamadas.push({ url, body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    };
    assert.deepEqual(await sendWebhookMessage(WEBHOOK, '@everyone oi', { fetchImpl }), { ok: true, status: 200 });
    assert.equal(chamadas[0].url, `${WEBHOOK}?wait=true`);
    assert.deepEqual(chamadas[0].body.allowed_mentions, { parse: [] });
    assert.deepEqual(await sendWebhookMessage('https://x.com', 'oi', { fetchImpl }), { ok: false, status: 0 });
    assert.equal(chamadas.length, 1);
  });

  test('429 com retry_after curto → uma nova tentativa', async () => {
    let n = 0;
    const fetchImpl = async () =>
      ++n === 1 ? new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }) : new Response('{}', { status: 200 });
    assert.deepEqual(await sendWebhookMessage(WEBHOOK, 'oi', { fetchImpl }), { ok: true, status: 200 });
    assert.equal(n, 2);
  });
});
