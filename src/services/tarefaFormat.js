// Como uma tarefa aparece em texto no Discord.
// Usado pelo /tarefa, pelo /painel, pelos lembretes e pelo relatório diário.

import { formatShort, formatDateTime } from './dateTime.js';

/** Evita que *, _, ~, ` etc. do título baguncem a formatação da mensagem. */
export function escapeMarkdown(texto) {
  return String(texto).replace(/([\\*_~`|>#[\]()-])/g, '\\$1');
}

/** True se a tarefa está pendente e o prazo já passou. */
export function estaAtrasada(t, agora = Date.now()) {
  return !t.concluida && t.prazo !== null && t.prazo !== undefined && t.prazo < agora;
}

/** Rótulo do tipo. 'tarefa' (o padrão) não aparece, para não poluir a lista. */
export const TIPO_ROTULO = Object.freeze({ melhoria: '✨ melhoria', estudo: '📚 estudo', reuniao: '👥 reunião' });

export function formatarTarefa(t, agora = Date.now()) {
  const marcador = t.concluida ? '✅' : '⬜';
  const titulo = escapeMarkdown(t.titulo);
  const tipo = TIPO_ROTULO[t.tipo] ? `${TIPO_ROTULO[t.tipo]} · ` : '';
  let texto = `${marcador} **#${t.id}** · ${tipo}${t.contexto} · ${t.concluida ? `~~${titulo}~~` : titulo}`;
  if (t.prazo !== null && t.prazo !== undefined) {
    texto += ` · 📅 ${formatShort(t.prazo)}`;
    if (estaAtrasada(t, agora)) texto += ' · ⚠️ atrasada';
  }
  if (t.descricao) texto += ' · 📄';
  return texto;
}

/** Cartão (embed) com todos os detalhes da tarefa, para o /tarefa ver. */
export function detalhesTarefa(t, agora = Date.now()) {
  const fields = [
    { name: 'Tipo', value: TIPO_ROTULO[t.tipo] ?? '📝 tarefa' },
    { name: 'Contexto', value: t.contexto },
    { name: 'Status', value: t.concluida ? `✅ concluída em ${formatDateTime(t.concluida_em)}` : estaAtrasada(t, agora) ? '⚠️ atrasada' : '⬜ pendente' },
    { name: 'Prazo', value: t.prazo ? formatDateTime(t.prazo) : 'sem prazo' },
    { name: 'Criada em', value: formatDateTime(t.criada_em) },
  ];
  return {
    title: `#${t.id} · ${t.titulo}`,
    // A descrição vai como foi digitada: formatação do Discord (`código`, **negrito**) funciona.
    description: t.descricao ?? '_Sem descrição. Use `/tarefa descrever id:' + t.id + '` para adicionar._',
    fields,
  };
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
