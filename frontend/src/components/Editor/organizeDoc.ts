import type { TiptapDoc } from '../../types';

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: unknown[] };

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function nodeText(node: Node): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

// Remove espaço em branco só no FIM do conteúdo de um bloco — nunca o espaço
// entre dois trechos inline (ex.: "Os " antes de um <strong>), que separa
// palavras. Desce até a última folha de texto do bloco e apara só ela.
function trimBlockTrailingText(node: Node): void {
  if (!node || node.type === 'codeBlock') return;
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    (node.content ?? []).forEach(trimBlockTrailingText); // cada listItem
    return;
  }
  const kids = node.content;
  if (!Array.isArray(kids) || kids.length === 0) return;
  const last = kids[kids.length - 1];
  if (typeof last.text === 'string') {
    last.text = last.text.replace(/[ \t]+$/, '');
    if (last.text === '') kids.pop();
  } else {
    trimBlockTrailingText(last); // desce no último filho de bloco (listItem→paragraph, blockquote→paragraph)
  }
}

function isEmptyPara(node: Node): boolean {
  return node.type === 'paragraph' && nodeText(node).trim() === '';
}
function isEmptyHeading(node: Node): boolean {
  return node.type === 'heading' && nodeText(node).trim() === '';
}
function isEmptyListItem(node: Node): boolean {
  return node.type === 'listItem' && nodeText(node).trim() === '' && (node.content ?? []).every(c => nodeText(c).trim() === '');
}

export function organizeDocStructure(input: TiptapDoc): TiptapDoc {
  const doc = clone(input) as unknown as Node;
  const top: Node[] = doc.content ?? [];

  // 1. trim de espaço no fim de cada bloco (sem tocar em espaços entre trechos inline)
  top.forEach(trimBlockTrailingText);

  // 2. remover headings vazios e listItems vazios (recursivo raso: listas de 1 nível)
  const pruned: Node[] = [];
  for (const node of top) {
    if (isEmptyHeading(node)) continue;
    if ((node.type === 'bulletList' || node.type === 'orderedList') && Array.isArray(node.content)) {
      node.content = node.content.filter(li => !isEmptyListItem(li));
      if (node.content.length === 0) continue;
    }
    pruned.push(node);
  }

  // 3. colapsar parágrafos vazios consecutivos
  const collapsed: Node[] = [];
  for (const node of pruned) {
    if (isEmptyPara(node) && collapsed.length > 0 && isEmptyPara(collapsed[collapsed.length - 1])) continue;
    collapsed.push(node);
  }

  // 4. remover parágrafos vazios no fim
  while (collapsed.length && isEmptyPara(collapsed[collapsed.length - 1])) collapsed.pop();

  // 5. normalizar níveis de heading via pilha de ancestrais (raw levels).
  //    A profundidade da pilha é o nível normalizado: sobe no máx. +1 (sem pulos),
  //    nunca abaixo de 1, e raw levels iguais → níveis normalizados iguais.
  const stack: number[] = [];
  for (const node of collapsed) {
    if (node.type !== 'heading') continue;
    const raw = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 1)));
    while (stack.length && raw <= stack[stack.length - 1]) stack.pop();
    stack.push(raw);
    node.attrs = { ...(node.attrs ?? {}), level: stack.length };
  }

  if (Array.isArray(doc.content)) doc.content = collapsed;
  return doc as unknown as TiptapDoc;
}

export function docsEqual(a: TiptapDoc, b: TiptapDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
