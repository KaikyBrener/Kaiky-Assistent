// Testes da regra "negado por padrão" (auditoria M4).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runCommand } from '../src/events/interactionHandler.js';
import { isOwnerOnly } from '../src/services/authService.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import { commandInteraction } from '../scripts/lib/signing.js';

const OWNER = '222222222222222222';
const STRANGER = '111111111111111111';
const config = { ownerId: OWNER, appName: 'Teste' };

// Comando que "esqueceu" de declarar ownerOnly.
const forgotFlag = {
  data: { name: 'tarefas-pessoais', description: 'x' },
  execute: async () => new Response('dados pessoais'),
};
const publicCommand = { ...forgotFlag, data: { name: 'publico', description: 'x' }, ownerOnly: false };

describe('Autorização negada por padrão', () => {
  test('isOwnerOnly: só `ownerOnly: false` libera', () => {
    assert.equal(isOwnerOnly({}), true);
    assert.equal(isOwnerOnly({ ownerOnly: true }), true);
    assert.equal(isOwnerOnly({ ownerOnly: undefined }), true);
    assert.equal(isOwnerOnly({ ownerOnly: 0 }), true); // só o booleano false libera
    assert.equal(isOwnerOnly({ ownerOnly: false }), false);
  });

  test('comando sem ownerOnly bloqueia estranhos', async () => {
    const res = await runCommand(forgotFlag, commandInteraction('tarefas-pessoais', STRANGER), { config });
    const data = await res.json();
    assert.match(data.data.content, /restrito ao proprietário/);
    assert.equal(data.data.flags, 64);
  });

  test('comando sem ownerOnly libera o proprietário', async () => {
    const res = await runCommand(forgotFlag, commandInteraction('tarefas-pessoais', OWNER), { config });
    assert.equal(await res.text(), 'dados pessoais');
  });

  test('comando com ownerOnly: false é público', async () => {
    const res = await runCommand(publicCommand, commandInteraction('publico', STRANGER), { config });
    assert.equal(await res.text(), 'dados pessoais');
  });

  test('registro: restritos ganham default_member_permissions "0"; públicos não', () => {
    const [restricted, open] = getCommandDefinitions([forgotFlag, publicCommand]);
    assert.equal(restricted.default_member_permissions, '0');
    assert.equal('default_member_permissions' in open, false);
  });

  test('/ping continua público (comportamento da Fase 1 preservado)', () => {
    const ping = getCommandDefinitions().find((d) => d.name === 'ping');
    assert.equal('default_member_permissions' in ping, false);
  });
});
