// Testes das regras do script de registro (auditoria B4, B5). Sem rede.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { planCommandChanges, hasChanges, validateDefinitions, SNOWFLAKE } from '../scripts/lib/commandPlan.js';

const ping = { type: 1, name: 'ping', description: 'Verifica se está online.' };

describe('planCommandChanges', () => {
  test('comando novo → criar', () => {
    assert.deepEqual(planCommandChanges([], [ping]).create, ['ping']);
  });

  test('igual ao Discord (com campos extras e nulls) → sem mudança', () => {
    const fromDiscord = { ...ping, id: '1', version: '2', application_id: '3', default_member_permissions: null };
    const plan = planCommandChanges([fromDiscord], [ping]);
    assert.deepEqual(plan.unchanged, ['ping']);
    assert.equal(hasChanges(plan), false);
  });

  test('descrição ou permissão diferente → atualizar', () => {
    assert.deepEqual(planCommandChanges([{ ...ping, description: 'antiga' }], [ping]).update, ['ping']);
    assert.deepEqual(
      planCommandChanges([ping], [{ ...ping, default_member_permissions: '0' }]).update,
      ['ping'],
    );
  });

  test('comando que saiu do código → REMOVER (bulk overwrite apaga)', () => {
    const plan = planCommandChanges([ping, { type: 1, name: 'tarefa', description: 'x' }], [ping]);
    assert.deepEqual(plan.remove, ['tarefa']);
    assert.equal(hasChanges(plan), true);
  });
});

describe('Validações', () => {
  test('nomes e descrições fora das regras do Discord', () => {
    assert.equal(validateDefinitions([ping]).length, 0);
    assert.equal(validateDefinitions([{ name: 'Ping', description: 'x' }]).length, 1);
    assert.equal(validateDefinitions([{ name: 'ping', description: '' }]).length, 1);
    assert.equal(validateDefinitions([ping, ping]).length, 1);
  });

  test('IDs do Discord', () => {
    assert.equal(SNOWFLAKE.test('123456789012345678'), true);
    assert.equal(SNOWFLAKE.test('../../x'), false);
    assert.equal(SNOWFLAKE.test('123'), false);
  });

  test('script recusa ID inválido antes de qualquer chamada de rede, sem imprimir o token', () => {
    let output = '';
    try {
      execFileSync(process.execPath, ['scripts/register-commands.js'], {
        env: { DISCORD_APPLICATION_ID: 'abc', DISCORD_TOKEN: 'TOKEN-SUPER-SECRETO', PATH: process.env.PATH },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      assert.fail('deveria ter falhado');
    } catch (error) {
      output = `${error.stdout}${error.stderr}`;
      assert.equal(error.status, 1);
    }
    assert.match(output, /DISCORD_APPLICATION_ID ausente ou inválido/);
    assert.equal(output.includes('TOKEN-SUPER-SECRETO'), false);
  });

  test('--dry-run funciona sem token e mostra o payload', () => {
    const output = execFileSync(process.execPath, ['scripts/register-commands.js', '--dry-run'], {
      env: { DISCORD_APPLICATION_ID: '123456789012345678', DISCORD_GUILD_ID: '876543210987654321', PATH: process.env.PATH },
      encoding: 'utf8',
    });
    assert.match(output, /\[dry-run\] Nada foi enviado/);
    assert.match(output, /"name": "ping"/);
  });
});
