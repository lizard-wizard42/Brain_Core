import { describe, expect, it } from 'vitest';
import { sessionToMarkdown } from './rememberExport';
import type { RememberSession } from '../../types';

const base: RememberSession = {
  id: 's1',
  started_at: '2026-08-27T20:41:00Z',
  ended_at: '2026-08-27T20:53:00Z',
  device_id: 'a7',
  status: 'ready',
  text: 'oi tudo bem então',
};

describe('sessionToMarkdown', () => {
  it('formata turnos com rótulo de falante e anexa o texto corrido', () => {
    const md = sessionToMarkdown({
      ...base,
      turns: [
        { speaker: 'me', text: 'oi tudo bem' },
        { speaker: 'other', text: 'então' },
      ],
    });
    expect(md).toContain('# Memória —');
    expect(md).toContain('**Você:** oi tudo bem');
    expect(md).toContain('**Outra pessoa:** então');
    expect(md).toContain('## Texto corrido');
    expect(md).toContain('oi tudo bem então');
  });

  it('cai para o texto plano quando não há falantes rotulados', () => {
    const md = sessionToMarkdown({ ...base, turns: [{ speaker: null, text: 'oi tudo bem então' }] });
    expect(md).toContain('oi tudo bem então');
    expect(md).not.toContain('**Você:**');
    expect(md).not.toContain('## Texto corrido');
  });

  it('usa session.text quando não há turnos', () => {
    const md = sessionToMarkdown(base);
    expect(md).toContain('oi tudo bem então');
  });
});
