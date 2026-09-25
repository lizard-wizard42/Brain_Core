import { describe, expect, it } from 'vitest';
import {
  extractCustomNodes, reinsertCustomNodes, docToMarkdown, markdownToDoc,
  findUnreinsertedTokens,
} from './editorMarkdown';
import type { TiptapDoc } from '../../types';

const attach = { type: 'attachmentBlock', attrs: { url: '/u/x.pdf', name: 'x.pdf' } };

const table = {
  type: 'table',
  content: [
    { type: 'tableRow', content: [
      { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c1' }] }] },
      { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c2' }] }] },
    ] },
  ],
};

describe('editorMarkdown', () => {
  it('extractCustomNodes troca nós customizados por parágrafos-token', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'antes' }] },
      attach,
      { type: 'paragraph', content: [{ type: 'text', text: 'depois' }] },
    ] } as TiptapDoc;
    const { doc: stripped, placeholders } = extractCustomNodes(doc);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].node).toEqual(attach);
    const mid = stripped.content![1] as any;
    expect(mid.type).toBe('paragraph');
    expect(mid.content[0].text).toBe(placeholders[0].token);
  });

  it('reinsertCustomNodes restaura o nó no lugar do token', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'antes' }] },
      attach,
    ] } as TiptapDoc;
    const { doc: stripped, placeholders } = extractCustomNodes(doc);
    const round = reinsertCustomNodes(stripped, placeholders);
    expect(round.content![1]).toEqual(attach);
  });

  it('extractCustomNodes protege tabela top-level e reinsertCustomNodes a restaura', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'antes' }] },
      table,
      { type: 'paragraph', content: [{ type: 'text', text: 'depois' }] },
    ] } as TiptapDoc;
    const { doc: stripped, placeholders } = extractCustomNodes(doc);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].node).toEqual(table);
    const mid = stripped.content![1] as any;
    expect(mid.type).toBe('paragraph');
    expect(mid.content[0].text).toBe(placeholders[0].token);
    const round = reinsertCustomNodes(stripped, placeholders);
    expect(round.content![1]).toEqual(table);
  });

  it('round-trip via markdown mantém a tabela protegida pelo token', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      table,
    ] } as TiptapDoc;
    const { doc: stripped, placeholders } = extractCustomNodes(doc);
    const md = docToMarkdown(stripped);
    expect(md).toContain(placeholders[0].token);
    const back = reinsertCustomNodes(markdownToDoc(md), placeholders);
    expect(back.content!.some((n: any) => n.type === 'table')).toBe(true);
  });

  it('docToMarkdown/markdownToDoc preservam títulos e listas', () => {
    const md = docToMarkdown({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Seção' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'um' }] }] },
      ] },
    ] } as TiptapDoc);
    expect(md).toContain('## Seção');
    expect(md).toMatch(/[-*] um/);
    const doc = markdownToDoc(md);
    expect(doc.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  it('round-trip preserva o token de nó customizado', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      attach,
    ] } as TiptapDoc;
    const { doc: stripped, placeholders } = extractCustomNodes(doc);
    const md = docToMarkdown(stripped);
    expect(md).toContain(placeholders[0].token);
    const back = reinsertCustomNodes(markdownToDoc(md), placeholders);
    expect(back.content!.some((n: any) => n.type === 'attachmentBlock')).toBe(true);
  });

  it('findUnreinsertedTokens: vazio quando todos os tokens são parágrafos próprios', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      attach,
    ] } as TiptapDoc;
    const { doc: stripped, placeholders } = extractCustomNodes(doc);
    expect(findUnreinsertedTokens(stripped, placeholders)).toEqual([]);
  });

  it('findUnreinsertedTokens: reporta token ausente ou não isolado', () => {
    const placeholders = [{ token: '⟦brain-node:0⟧', node: attach }];
    const dropped = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'sem token' }] },
    ] } as TiptapDoc;
    expect(findUnreinsertedTokens(dropped, placeholders)).toEqual(['⟦brain-node:0⟧']);
    const buried = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '⟦brain-node:0⟧' }] },
    ] } as TiptapDoc;
    expect(findUnreinsertedTokens(buried, placeholders)).toEqual(['⟦brain-node:0⟧']);
  });
});
