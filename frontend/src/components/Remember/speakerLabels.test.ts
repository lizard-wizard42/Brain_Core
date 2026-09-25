import { describe, expect, it } from 'vitest';
import { clusterLetter, clusterLabel, personTint, pendingCount, isMyTurn } from './speakerLabels';
import type { RememberSession, RememberDay, RememberTurn } from '../../types';

const cl = (over: Partial<import('../../types').RememberSpeakerCluster>) => ({
  cluster: 1, status: 'pending' as const, person_id: null, name: null, is_me: false,
  suggested: null, sample_segment_id: null, total_ms: 0, turn_count: 0, ...over,
});
const session = (speakers: any[]): RememberSession => ({
  id: 's1', started_at: '', ended_at: null, device_id: null, status: 'ready', text: null, speakers,
});

describe('speakerLabels', () => {
  it('clusterLetter: 1→A, 2→B, 3→C', () => {
    expect(clusterLetter(1)).toBe('A');
    expect(clusterLetter(2)).toBe('B');
    expect(clusterLetter(3)).toBe('C');
  });

  it('clusterLabel: null/undefined → —', () => {
    expect(clusterLabel(session([]), null)).toBe('—');
    expect(clusterLabel(session([]), undefined)).toBe('—');
  });

  it('clusterLabel: cluster nulo + speaker legado → rótulo pt-BR', () => {
    expect(clusterLabel(session([]), null, 'other')).toBe('Outra pessoa');
    expect(clusterLabel(session([]), null, 'me')).toBe('Você');
    expect(clusterLabel(session([]), null, 'unknown')).toBe('Não identificado');
    expect(clusterLabel(session([]), null, null)).toBe('—');
  });

  it('clusterLabel: entrada real em speakers vence o fallback de speaker', () => {
    expect(clusterLabel(session([cl({ status: 'confirmed', name: 'Ana', person_id: 4 })]), 1, 'other')).toBe('Ana');
  });

  it('clusterLabel: is_me → Você', () => {
    expect(clusterLabel(session([cl({ cluster: 0, is_me: true })]), 0)).toBe('Você');
  });

  it('clusterLabel: confirmed com nome → nome', () => {
    expect(clusterLabel(session([cl({ status: 'confirmed', name: 'Cláudio', person_id: 3 })]), 1)).toBe('Cláudio');
  });

  it('clusterLabel: pending → Falante A', () => {
    expect(clusterLabel(session([cl({ cluster: 1 })]), 1)).toBe('Falante A');
  });

  it('clusterLabel: cluster sem entrada em speakers → Falante <letra>', () => {
    expect(clusterLabel(session([]), 2)).toBe('Falante B');
  });

  it('personTint: id nulo → cinza; ids diferentes → classes possivelmente diferentes, sempre string', () => {
    expect(typeof personTint(null)).toBe('string');
    expect(typeof personTint(7)).toBe('string');
    expect(personTint(7)).toBe(personTint(7)); // estável
  });

  it('isMyTurn: identidade do cluster vence o speaker do diarizer', () => {
    const t = (over: Partial<RememberTurn>): RememberTurn => ({ speaker: null, text: 'x', ...over });
    // sem cluster → cai no speaker legado
    expect(isMyTurn(session([]), t({ speaker: 'me', cluster: null }))).toBe(true);
    expect(isMyTurn(session([]), t({ speaker: 'other', cluster: null }))).toBe(false);
    // cluster 0 é sempre eu
    expect(isMyTurn(session([]), t({ speaker: 'other', cluster: 0 }))).toBe(true);
    // is_me do cluster vence o speaker derivado
    expect(isMyTurn(session([cl({ cluster: 1, is_me: true })]), t({ speaker: 'other', cluster: 1 }))).toBe(true);
    // cluster não-is_me: mesmo o diarizer dizendo 'me' (drift), não é minha fala
    expect(isMyTurn(session([cl({ cluster: 2, is_me: false })]), t({ speaker: 'me', cluster: 2 }))).toBe(false);
    expect(isMyTurn(session([]), t({ speaker: 'other', cluster: 3 }))).toBe(false);
  });

  it('pendingCount: soma clusters pending e não-is_me do dia', () => {
    const day = {
      date: '2026-08-20', total_seconds: 0, session_count: 2,
      sessions: [
        session([cl({ cluster: 0, is_me: true }), cl({ cluster: 1, status: 'pending' }), cl({ cluster: 2, status: 'confirmed', person_id: 9, name: 'X' })]),
        session([cl({ cluster: 1, status: 'pending' })]),
      ],
    } as RememberDay;
    expect(pendingCount(day)).toBe(2);
    expect(pendingCount(null)).toBe(0);
  });
});
