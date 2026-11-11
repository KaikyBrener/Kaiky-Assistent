// Como uma tarefa aparece em texto no Discord.
// Usado pelo /tarefa, pelo /painel, pelos lembretes e pelo relatório diário.

import { formatShort } from './dateTime.js';

/** Evita que *, _, ~, ` etc. do título baguncem a formatação da mensagem. */
export function escapeMarkdown(texto) {
  return String(texto).replace(/([\\*_~`|>#[\]()-])/g, '\\$1');
}

/** True se a tarefa está pendente e o prazo já passou. */
export function estaAtrasada(t, agora = Date.now()) {
  return !t.concluida && t.prazo !== null && t.prazo !== undefined && t.prazo < agora;
}

export function formatarTarefa(t, agora = Date.now()) {
  const marcador = t.concluida ? '✅' : '⬜';
  const titulo = escapeMarkdown(t.titulo);
  let texto = `${marcador} **#${t.id}** · ${t.contexto} · ${t.concluida ? `~~${titulo}~~` : titulo}`;
  if (t.prazo !== null && t.prazo !== undefined) {
    texto += ` · 📅 ${formatShort(t.prazo)}`;
    if (estaAtrasada(t, agora)) texto += ' · ⚠️ atrasada';
  }
  return texto;
}

/**
 * Junta linhas sem passar do limite de 2000 caracteres do Discord.
 * Se faltar espaço, termina com "… e mais N".
 */
export function juntarComLimite(cabecalho, linhas, limite = 1900) {
  const saida = [cabecalho];
  let tamanho = cabecalho.length;
  for (let i = 0; i < linhas.length; i++) {
    if (tamanho + linhas[i].length + 1 > limite) {
      saida.push(`… e mais ${linhas.length - i}.`);
      break;
    }
    saida.push(linhas[i]);
    tamanho += linhas[i].length + 1;
  }
  return saida.join('\n');
}
