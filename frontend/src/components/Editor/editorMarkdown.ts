import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import type { TiptapDoc } from '../../types';

// `table` está aqui — e não só os blocos custom — porque o `tiptap-markdown` em
// modo `html: false` serializa qualquer tabela sem header row para o literal
// `[table]`, o que faria a IA perder a tabela silenciosamente no round-trip.
// Tabelas são sempre top-level neste editor, então recebem a mesma proteção via
// placeholder `⟦brain-node:N⟧`.
export const CUSTOM_NODE_TYPES = ['attachmentBlock', 'subPageBlock', 'table'] as const;

const CONVERSION_EXTENSIONS = [
  StarterKit.configure({ codeBlock: {}, underline: false, link: false }),
  Table, TableRow, TableHeader, TableCell,
  TaskList, TaskItem.configure({ nested: true }),
  Highlight.configure({ multicolor: true }),
  TextStyle, Color, Underline,
  Link.configure({ openOnClick: false }),
  Image.configure({ inline: false, allowBase64: false }),
  Markdown.configure({ html: false, tightLists: true, transformPastedText: false }),
];

function headlessEditor(content: TiptapDoc | string): Editor {
  return new Editor({ extensions: CONVERSION_EXTENSIONS, content });
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function extractCustomNodes(
  input: TiptapDoc,
): { doc: TiptapDoc; placeholders: Array<{ token: string; node: unknown }> } {
  const doc = clone(input);
  const placeholders: Array<{ token: string; node: unknown }> = [];
  const content = Array.isArray(doc.content) ? doc.content : [];
  doc.content = content.map((node: any) => {
    if (node && (CUSTOM_NODE_TYPES as readonly string[]).includes(node.type)) {
      const token = `⟦brain-node:${placeholders.length}⟧`;
      placeholders.push({ token, node: clone(node) });
      return { type: 'paragraph', content: [{ type: 'text', text: token }] };
    }
    return node;
  });
  return { doc, placeholders };
}

export function reinsertCustomNodes(
  input: TiptapDoc,
  placeholders: Array<{ token: string; node: unknown }>,
): TiptapDoc {
  if (!placeholders.length) return input;
  const doc = clone(input);
  const byToken = new Map(placeholders.map((p) => [p.token, p.node]));
  const content = Array.isArray(doc.content) ? doc.content : [];
  doc.content = content.map((node: any) => {
    const text = node?.type === 'paragraph'
      ? (node.content ?? []).map((c: any) => c?.text ?? '').join('').trim()
      : '';
    if (text && byToken.has(text)) return clone(byToken.get(text));
    return node;
  });
  return doc;
}

/**
 * Dado o doc produzido pela IA (antes do `reinsertCustomNodes`), retorna os
 * tokens de placeholder que NÃO poderão ser reinseridos — porque a IA os
 * removeu ou os enterrou dentro de outro nó (heading, lista, etc.) em vez de
 * mantê-los como um parágrafo isolado. Qualquer token retornado significa que
 * a reorganização perderia/deslocaria um bloco anexado e deve ser abortada.
 */
export function findUnreinsertedTokens(
  input: TiptapDoc,
  placeholders: Array<{ token: string; node: unknown }>,
): string[] {
  if (!placeholders.length) return [];
  const content = Array.isArray(input.content) ? input.content : [];
  const standaloneParagraphTokens = new Set(
    content
      .filter((node: any) => node?.type === 'paragraph')
      .map((node: any) => (node.content ?? []).map((c: any) => c?.text ?? '').join('').trim())
      .filter(Boolean),
  );
  return placeholders
    .map((p) => p.token)
    .filter((token) => !standaloneParagraphTokens.has(token));
}

export function docToMarkdown(doc: TiptapDoc): string {
  const editor = headlessEditor(doc);
  try {
    const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
    if (!storage.markdown) {
      throw new Error('tiptap-markdown storage não disponível (extensão Markdown ausente?)');
    }
    return storage.markdown.getMarkdown();
  } finally {
    editor.destroy();
  }
}

export function markdownToDoc(markdown: string): TiptapDoc {
  const editor = headlessEditor(markdown);
  try {
    return editor.getJSON() as TiptapDoc;
  } finally {
    editor.destroy();
  }
}
