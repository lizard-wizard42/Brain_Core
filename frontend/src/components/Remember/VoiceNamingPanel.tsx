import { useState } from 'react';
import { rememberService, type ParticipantIdentity } from '../../services/rememberService';
import type { RememberTurn } from '../../types';

export type VoiceLabel = NonNullable<RememberTurn['voice_label']>;
export interface VoiceGroup { voice: string; count: number; sample: string; probableMe: boolean; label: VoiceLabel | null; defaultLabel: string }

const voiceIndex = (voice: string) => Number(voice.replace(/^speaker_/, ''));

interface Props { sessionId: string; groups: VoiceGroup[]; onChange: (voice: string, label: VoiceLabel | null) => void }

/** Name a voice once; every line of that voice in the session follows. */
export function VoiceNamingPanel({ sessionId, groups, onChange }: Props) {
  const [identities, setIdentities] = useState<ParticipantIdentity[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const loadIdentities = () => {
    if (identities) return;
    rememberService.getParticipantIdentities(sessionId).then(setIdentities).catch(() => setIdentities([]));
  };
  const save = async (group: VoiceGroup) => {
    setBusy(group.voice); setError('');
    try {
      let identityId = picked[group.voice] || '';
      let displayName = identities?.find(item => item.id === identityId)?.display_name || '';
      let isOwner = !!identities?.find(item => item.id === identityId)?.is_owner;
      const typed = (names[group.voice] || '').trim();
      if (typed) {
        const created = await rememberService.createParticipantIdentity(sessionId, typed);
        identityId = created.id; displayName = created.display_name; isOwner = false;
        setIdentities(previous => [...(previous || []).filter(item => item.id !== created.id), created]);
        setNames(previous => ({ ...previous, [group.voice]: '' }));
      }
      if (!identityId) { setError('Escolha um participante ou digite um nome.'); return; }
      await rememberService.setVoiceLabel(sessionId, voiceIndex(group.voice), identityId);
      onChange(group.voice, { identity_id: identityId, display_name: displayName || 'Participante', is_owner: isOwner });
    } catch { setError('Não foi possível salvar o nome desta voz.'); }
    finally { setBusy(null); }
  };
  const clear = async (group: VoiceGroup) => {
    setBusy(group.voice); setError('');
    try { await rememberService.setVoiceLabel(sessionId, voiceIndex(group.voice), null); onChange(group.voice, null); }
    catch { setError('Não foi possível remover o nome desta voz.'); }
    finally { setBusy(null); }
  };
  return <details className="conversation-identity" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) loadIdentities(); }}>
    <summary className="conversation-disclosure">Vozes da conversa ({groups.length})</summary>
    <div className="conversation-identity-body space-y-3">
      <p className="conversation-caption">Dê um nome a cada voz uma vez: todas as falas dela nesta sessão passam a usar esse nome. Uma identificação feita numa fala isolada continua valendo mais.</p>
      {groups.map(group => <div key={group.voice} className="space-y-2 rounded-lg border border-[var(--theme-border)] p-3" data-testid={`voice-${group.voice}`}>
        <p><strong>{group.label ? (group.label.is_owner ? 'Eu' : group.label.display_name) : group.defaultLabel}</strong> · {group.count} {group.count === 1 ? 'fala' : 'falas'}{group.probableMe && !group.label ? ' · combina com a sua voz' : ''}</p>
        {group.sample && <p className="conversation-caption truncate">“{group.sample}”</p>}
        <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void save(group); }}>
          <select aria-label={`Participante para ${group.defaultLabel}`} className="conversation-input" disabled={busy === group.voice}
            value={picked[group.voice] || ''} onChange={event => setPicked(previous => ({ ...previous, [group.voice]: event.target.value }))}>
            <option value="">Escolha participante</option>
            {(identities || []).map(item => <option key={item.id} value={item.id}>{item.is_owner ? 'Eu' : item.display_name}</option>)}
          </select>
          <input aria-label={`Novo nome para ${group.defaultLabel}`} className="conversation-input w-36" maxLength={40} placeholder="Ou novo nome"
            disabled={busy === group.voice} value={names[group.voice] || ''} onChange={event => setNames(previous => ({ ...previous, [group.voice]: event.target.value }))} />
          <button type="submit" className="conversation-button conversation-button-primary" disabled={busy === group.voice}>Nomear voz</button>
          {group.label && <button type="button" className="conversation-button" disabled={busy === group.voice} onClick={() => void clear(group)}>Remover nome</button>}
        </form>
      </div>)}
      {error && <p role="alert" className="conversation-error">{error}</p>}
    </div>
  </details>;
}
