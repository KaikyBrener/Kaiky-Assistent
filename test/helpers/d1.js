// Helper de teste: um D1 LOCAL de verdade dentro do Node, via getPlatformProxy
// (já vem no Wrangler). Nada aqui toca o banco real da Cloudflare.

import { readdir, readFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';

/** Aplica as migrations da pasta /migrations, em ordem. */
async function aplicarMigrations(db) {
  const arquivos = (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const arquivo of arquivos) {
    const sql = (await readFile(`migrations/${arquivo}`, 'utf8'))
      .split('\n')
      .filter((linha) => !linha.trim().startsWith('--'))
      .join('\n');
    for (const instrucao of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(instrucao).run();
    }
  }
}

export async function criarD1DeTeste() {
  const proxy = await getPlatformProxy({
    configPath: './wrangler.jsonc',
    persist: false, // banco em memória: some ao final
    remoteBindings: false, // NUNCA conecta no banco remoto
    envFiles: [], // não lê o seu .dev.vars
  });
  await aplicarMigrations(proxy.env.DB);
  return {
    db: proxy.env.DB,
    async limpar() {
      await proxy.env.DB.batch([
        proxy.env.DB.prepare('DELETE FROM notificacoes'),
        proxy.env.DB.prepare('DELETE FROM tarefas'),
      ]);
    },
    dispose: () => proxy.dispose(),
  };
}
