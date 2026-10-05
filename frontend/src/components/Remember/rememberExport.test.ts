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
  it('formata a conversa sem duplicar a transcrição', () => {
    const md = sessionToMarkdown({
      ...base,
      turns: [
        { speaker: 'me', text: 'oi tudo bem' },
        { speaker: 'other', text: 'então' },
      ],
    });
    expect(md).toContain('# Memória —');
    expect(md).toContain('**Eu:** oi tudo bem');
    expect(md).toContain('**Participante:** então');
    expect(md).not.toContain('## Texto corrido');
    expect(md.match(/oi tudo bem/g)).toHaveLength(1);
  });

  it('cai para o texto plano quando não há falantes rotulados', () => {
    const md = sessionToMarkdown({ ...base, turns: [{ speaker: null, text: 'oi tudo bem então' }] });
    expect(md).toContain('oi tudo bem então');
    expect(md).not.toContain('**Eu:**');
    expect(md).not.toContain('## Texto corrido');
  });

  it('usa session.text quando não há turnos', () => {
    const md = sessionToMarkdown(base);
    expect(md).toContain('oi tudo bem então');
  });

  it('usa o nome escolhido na exportação da sessão', () => {
    localStorage.setItem('brain-core:speaker-aliases:s1', JSON.stringify({ other: 'Professor' }));
    const md = sessionToMarkdown({ ...base, turns: [{ speaker: 'other', text: 'vamos começar' }] });
    expect(md).toContain('**Professor:** vamos começar');
    localStorage.removeItem('brain-core:speaker-aliases:s1');
  });
  it('exports the reviewed labels shown in the conversation', () => {
    const md = sessionToMarkdown({ ...base, turns: [{id: 7, speaker: 'unknown', text: 'Trecho fictício'}] }, {0: 'Eu'});
    expect(md).toContain('**Eu:** Trecho fictício');
    expect(md).not.toContain('Não identificado');
  });

});
