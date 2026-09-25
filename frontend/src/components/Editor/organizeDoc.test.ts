import { describe, expect, it } from 'vitest';
import { organizeDocStructure, docsEqual } from './organizeDoc';
import type { TiptapDoc } from '../../types';

const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const p = (text = '') => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const doc = (...content: unknown[]): TiptapDoc => ({ type: 'doc', content } as TiptapDoc);

describe('organizeDocStructure', () => {
  it('corrige pulo de nível de heading (H1 -> H3 vira H1 -> H2)', () => {
    const out = organizeDocStructure(doc(h(1, 'A'), h(3, 'B')));
    expect(out.content?.map((n: any) => n.attrs?.level)).toEqual([1, 2]);
  });

  it('nunca promove acima de H1 e preserva descidas de 1 nível', () => {
    const out = organizeDocStructure(doc(h(2, 'A'), h(3, 'B'), h(2, 'C')));
    expect(out.content?.map((n: any) => n.attrs?.level)).toEqual([1, 2, 1]);
  });

  it('mantém subheading final como filho da seção ([1,3,2] -> [1,2,2])', () => {
    const out = organizeDocStructure(doc(h(1, 'A'), h(3, 'B'), h(2, 'C')));
    expect(out.content?.map((n: any) => n.attrs?.level)).toEqual([1, 2, 2]);
  });

  it('não promove subheading de nível médio para H1 ([2,4,3] -> [1,2,2])', () => {
    const out = organizeDocStructure(doc(h(2, 'A'), h(4, 'B'), h(3, 'C')));
    expect(out.content?.map((n: any) => n.attrs?.level)).toEqual([1, 2, 2]);
  });

  it('retorno ao nível de seção não cai para H1 ([1,2,4,2] -> [1,2,3,2])', () => {
    const out = organizeDocStructure(doc(h(1, 'A'), h(2, 'B'), h(4, 'C'), h(2, 'D')));
    expect(out.content?.map((n: any) => n.attrs?.level)).toEqual([1, 2, 3, 2]);
  });

  it('docsEqual é true para doc sem content (no-op)', () => {
    const input = { type: 'doc' } as unknown as TiptapDoc;
    expect(docsEqual(input, organizeDocStructure(input))).toBe(true);
  });

  it('colapsa parágrafos vazios consecutivos em um', () => {
    const out = organizeDocStructure(doc(p('x'), p(), p(), p('y')));
    expect(out.content).toHaveLength(3);
  });

  it('remove parágrafos vazios no fim do documento', () => {
    const out = organizeDocStructure(doc(p('x'), p(), p()));
    expect(out.content).toHaveLength(1);
  });

  it('remove headings vazios', () => {
    const out = organizeDocStructure(doc(h(1, 'A'), { type: 'heading', attrs: { level: 2 }, content: [] }));
    expect(out.content).toHaveLength(1);
  });

  it('faz trim de espaço em branco no fim dos nós de texto', () => {
    const out = organizeDocStructure(doc(p('linha   ')));
    expect((out.content?.[0] as any).content[0].text).toBe('linha');
  });

  it('NÃO remove o espaço entre um texto normal e um trecho em negrito', () => {
    const para = { type: 'paragraph', content: [
      { type: 'text', text: 'Os ' },
      { type: 'text', text: 'Modelos', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' revolucionaram a forma.' },
    ] };
    const out = organizeDocStructure(doc(para));
    expect((out.content?.[0] as any).content.map((n: any) => n.text))
      .toEqual(['Os ', 'Modelos', ' revolucionaram a forma.']);
  });

  it('apara só o espaço no fim do parágrafo, mesmo quando o último trecho é estilizado', () => {
    const para = { type: 'paragraph', content: [
      { type: 'text', text: 'ver ' },
      { type: 'text', text: 'aqui   ', marks: [{ type: 'italic' }] },
    ] };
    const out = organizeDocStructure(doc(para));
    expect((out.content?.[0] as any).content.map((n: any) => n.text)).toEqual(['ver ', 'aqui']);
  });

  it('doc com formatação inline mid-parágrafo é no-op (docsEqual true)', () => {
    const d = doc({ type: 'paragraph', content: [
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' c' },
    ] });
    expect(docsEqual(d, organizeDocStructure(d))).toBe(true);
  });

  it('não muta a entrada', () => {
    const input = doc(h(1, 'A'), h(3, 'B'));
    const snapshot = JSON.stringify(input);
    organizeDocStructure(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('docsEqual detecta ausência de mudança', () => {
    const d = doc(h(1, 'A'), p('b'));
    expect(docsEqual(d, organizeDocStructure(d))).toBe(true);
  });
});
