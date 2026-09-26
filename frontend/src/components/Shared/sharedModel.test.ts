import { describe, expect, it } from 'vitest';
import type { SharedPageSummary, TiptapDoc } from '../../types';
import { contentToBlocks, filterSharedPages, formatDateTime, mergeSharedPages, roleLabel, summarizeDiff } from './sharedModel';

function shared(id: string, title: string): SharedPageSummary {
  return {
    id,
    title,
    slug: title.toLowerCase(),
    type: 'note',
    updated_at: '2026-09-25T12:00:00.000Z',
    role: 'viewer',
  };
}

function doc(...blocks: string[]): TiptapDoc {
  return {
    type: 'doc',
    content: blocks.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

describe('mergeSharedPages', () => {
  it('removes duplicates across received and sent, received wins', () => {
    const received = [shared('a', 'Recebida A'), shared('b', 'Recebida B')];
    const sent = [shared('b', 'Duplicada'), shared('c', 'Enviada C')];
    const { received: r, sent: s } = mergeSharedPages(received, sent);
    expect(r.map((p) => p.id)).toEqual(['a', 'b']);
    expect(s.map((p) => p.id)).toEqual(['c']);
  });

  it('drops duplicate ids inside a bucket keeping the first', () => {
    const { received } = mergeSharedPages([shared('a', 'Primeira'), shared('a', 'Segunda')], []);
    expect(received).toHaveLength(1);
    expect(received[0].title).toBe('Primeira');
  });
});

describe('filterSharedPages', () => {
  it('filters by title case-insensitively', () => {
    const list = [shared('a', 'Relatório'), shared('b', 'Notas')];
    expect(filterSharedPages(list, 'relat').map((p) => p.id)).toEqual(['a']);
    expect(filterSharedPages(list, '  ').map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('roleLabel and formatDateTime', () => {
  it('labels roles in Portuguese', () => {
    expect(roleLabel('owner')).toBe('Dono');
    expect(roleLabel('editor')).toBe('Pode editar');
    expect(roleLabel('viewer')).toBe('Pode ler');
  });

  it('returns empty string for invalid dates', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
    expect(formatDateTime('2026-09-25T12:00:00.000Z')).not.toBe('');
  });
});

describe('summarizeDiff', () => {
  it('counts added and removed blocks', () => {
    const before = doc('Um', 'Dois');
    const after = doc('Um', 'Três');
    const summary = summarizeDiff(before, after);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.label).toContain('adicionado');
    expect(summary.label).toContain('removido');
  });

  it('reports no relevant changes for identical content', () => {
    const summary = summarizeDiff(doc('Igual'), doc('Igual'));
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.label).toBe('Sem mudanças de texto relevantes');
  });

  it('extracts plain-text blocks and ignores empty paragraphs', () => {
    expect(contentToBlocks(doc('A', '', 'B'))).toEqual(['A', 'B']);
    expect(contentToBlocks(undefined)).toEqual([]);
  });
});
