// Formulários (modais) do Discord: a forma de digitar textos LONGOS.
//
// Uma opção de slash command só aceita uma linha. Para descrições de
// várias linhas (ex.: a descrição de um PR), o bot responde com um MODAL
// (type 9). O usuário preenche e o Discord manda de volta uma interação
// MODAL_SUBMIT (type 5) com os valores.
//
// O `custom_id` do modal diz quem deve tratar o envio:
//   "<comando>:<acao>"       ex.: "bug:registrar"
//   "<comando>:<acao>:<id>"  ex.: "tarefa:descrever:12"
// Docs: components/reference (Label + Text Input)

import { json } from './responses.js';

export const TextStyle = Object.freeze({ SHORT: 1, PARAGRAPH: 2 });
const CUSTOM_ID = /^([a-z]+):([a-z]+)(?::(\d{1,12}))?$/;

/**
 * Monta a resposta que abre um formulário.
 * @param {{ customId: string, title: string, fields: Array<{
 *   id: string, label: string, description?: string, style?: number,
 *   required?: boolean, maxLength?: number, value?: string|null, placeholder?: string }> }} modal
 */
export function modalResponse({ customId, title, fields }) {
  return json({
    type: 9, // MODAL
    data: {
      custom_id: customId,
      title: title.slice(0, 45),
      components: fields.slice(0, 5).map((f) => ({
        type: 18, // LABEL
        label: f.label.slice(0, 45),
        ...(f.description ? { description: f.description.slice(0, 100) } : {}),
        component: {
          type: 4, // TEXT_INPUT
          custom_id: f.id,
          style: f.style ?? TextStyle.PARAGRAPH,
          required: f.required ?? false,
          max_length: f.maxLength ?? 4000,
          ...(f.value ? { value: String(f.value).slice(0, f.maxLength ?? 4000) } : {}),
          ...(f.placeholder ? { placeholder: f.placeholder.slice(0, 100) } : {}),
        },
      })),
    },
  });
}

/** Lê o custom_id do modal enviado. Formato inválido → null. */
export function parseModalCustomId(customId) {
  const match = typeof customId === 'string' ? customId.match(CUSTOM_ID) : null;
  if (!match) return null;
  return { command: match[1], action: match[2], id: match[3] === undefined ? null : Number(match[3]) };
}

/**
 * Extrai os valores digitados: { campo: "texto" }.
 * Aceita o formato atual (Label) e o antigo (Action Row).
 */
export function readModalValues(interaction) {
  const values = {};
  const visit = (component) => {
    if (!component || typeof component !== 'object') return;
    if (component.type === 4 && typeof component.custom_id === 'string') {
      values[component.custom_id] = typeof component.value === 'string' ? component.value : '';
    }
    if (component.component) visit(component.component); // Label
    for (const child of component.components ?? []) visit(child); // Action Row
  };
  for (const component of interaction?.data?.components ?? []) visit(component);
  return values;
}
