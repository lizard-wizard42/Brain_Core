import { useCallback, useRef, useState } from 'react';
import type { RememberSession } from '../../types';
import { TranscriptDialogue } from './TranscriptDialogue';
import { copySessionMarkdown, downloadSessionMarkdown } from './rememberExport';

interface Props {
  session: RememberSession;
  onlyMe: boolean;
  onCreateNote?: (kind: 'note' | 'reminder') => void;
  onUseVoice: () => Promise<void>;
}

/** Reading stays primary; session tools and voice setup are disclosed on demand. */
export function RememberConversation({ session, onlyMe, onCreateNote, onUseVoice }: Props) {
  const labels = useRef<Record<number, string>>({});
  const updateLabels = useCallback((next: Record<number, string>) => { labels.current = next; }, []);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceSetup, setVoiceSetup] = useState(false);
  const [error, setError] = useState('');
  const hasText = !!session.text?.trim() || !!session.turns?.some(turn => turn.text.trim());
  const copy = async () => {
    setError(''); setFeedback('');
    const ok = await copySessionMarkdown(session, labels.current);
    if (ok) setFeedback('Conversa copiada. Cole onde quiser.');
    else setError('Não foi possível copiar. Use “Baixar conversa (.md)” em Mais ações.');
  };
  const handleUseVoice = async () => {
    setBusy(true); setError(''); setFeedback('');
    try { await onUseVoice(); setFeedback('Referência de voz atualizada.'); setVoiceSetup(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a referência de voz.'); }
    finally { setBusy(false); }
  };
  return <>
    <TranscriptDialogue session={session} onlyMe={onlyMe} onLabelsChange={updateLabels} />
    {session.status === 'ready' && <footer className="conversation-actions" aria-label="Ações da sessão">
      <div className="flex flex-wrap items-center gap-2">
        {onCreateNote && <button type="button" disabled={!hasText} className="conversation-button conversation-button-primary" onClick={() => onCreateNote('note')}><span aria-hidden="true">＋</span> Criar nota</button>}
        <button type="button" disabled={!hasText} className="conversation-button" onClick={() => void copy()}>Copiar conversa</button>
        <details className="conversation-more">
          <summary className="conversation-button">Mais ações <span aria-hidden="true">⌄</span></summary>
          <div className="conversation-more-items">
            <button type="button" disabled={!hasText} className="conversation-button" onClick={() => { downloadSessionMarkdown(session, labels.current); setFeedback('Download da conversa iniciado.'); }}>Baixar conversa (.md)</button>
            {onCreateNote && <button type="button" disabled={!hasText} className="conversation-button" onClick={() => onCreateNote('reminder')}>Criar lembrete</button>}
            <button type="button" className="conversation-button" aria-expanded={voiceSetup} onClick={() => setVoiceSetup(value => !value)}>Usar como referência de voz</button>
          </div>
        </details>
      </div>
      <p className="conversation-caption">Copiar e baixar incluem a conversa inteira, mesmo com o filtro ativo.</p>
      {voiceSetup && <div className="conversation-voice-setup">
        <strong>Referência de voz</strong>
        <p>Use uma gravação de 8 a 60 segundos em que só você fala. Esta ação substitui sua amostra cadastrada e ajuda a sugerir quem falou nas próximas revisões.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className="conversation-button conversation-button-primary" disabled={busy} onClick={() => void handleUseVoice()}>{busy ? 'Atualizando referência…' : 'Usar esta gravação'}</button><button type="button" className="conversation-button" disabled={busy} onClick={() => setVoiceSetup(false)}>Cancelar</button></div>
      </div>}
      {feedback && <p role="status" className="conversation-caption">{feedback}</p>}
      {error && <p role="alert" className="conversation-error">{error}</p>}
    </footer>}
  </>;
}
