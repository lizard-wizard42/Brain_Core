import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RememberConversation } from './RememberConversation';
import { copySessionMarkdown, downloadSessionMarkdown } from './rememberExport';
import { rememberService } from '../../services/rememberService';
import type { RememberSession } from '../../types';

vi.mock('./rememberExport', () => ({ copySessionMarkdown: vi.fn(), downloadSessionMarkdown: vi.fn() }));
vi.mock('../../services/rememberService', () => ({ rememberService: { getSegmentParticipants: vi.fn(), getParticipantIdentities: vi.fn() } }));
const session: RememberSession = {id:'demo', status:'ready', started_at:'2026-10-05T09:00:00Z', ended_at:'2026-10-05T09:01:00Z', device_id:null, text:null, turns:[{id:1,speaker:'unknown',text:'Conversa fictícia'}]};
describe('RememberConversation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rememberService.getSegmentParticipants).mockResolvedValue({decision:{identity_id:'owner',is_owner:true,display_name:'Minha voz',action:'confirm',created_at:'now'}, suggestions:[]});
    vi.mocked(rememberService.getParticipantIdentities).mockResolvedValue([{id:'owner',display_name:'Minha voz',is_owner:true}]);
  });
  afterEach(cleanup);
  it('keeps correction controls collapsed and copies reviewed identities', async () => {
    vi.mocked(copySessionMarkdown).mockResolvedValue(true);
    render(<RememberConversation session={session} onlyMe={false} onUseVoice={vi.fn()} />);
    await screen.findByText('Eu', {selector: '.speaker-label'});
    expect(screen.getByRole('button', {name:'Corrigir'})).not.toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Copiar conversa'}));
    await screen.findByText('Conversa copiada. Cole onde quiser.');
    expect(copySessionMarkdown).toHaveBeenCalledWith(session, {0:'Eu'});
    fireEvent.click(screen.getByText('Alterar participante'));
    expect(screen.getByRole('button',{name:'Corrigir'})).toBeVisible();
  });
  it('reports failed clipboard access without falsely claiming success or downloading', async () => {
    vi.mocked(copySessionMarkdown).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<RememberConversation session={session} onlyMe={false} onUseVoice={vi.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'Copiar conversa'}));
    await screen.findByText('Conversa copiada. Cole onde quiser.');
    fireEvent.click(screen.getByRole('button',{name:'Copiar conversa'}));
    await screen.findByRole('alert');
    expect(downloadSessionMarkdown).not.toHaveBeenCalled();
    expect(screen.queryByText('Conversa copiada. Cole onde quiser.')).not.toBeInTheDocument();
  });
  it('discloses secondary actions and explains voice replacement before applying it', async () => {
    const onUseVoice = vi.fn().mockResolvedValue(undefined), onCreateNote = vi.fn();
    render(<RememberConversation session={session} onlyMe={false} onUseVoice={onUseVoice} onCreateNote={onCreateNote} />);
    fireEvent.click(screen.getByRole('button',{name:/Criar nota/}));
    expect(onCreateNote).toHaveBeenCalledWith('note');
    fireEvent.click(screen.getByText(/Mais ações/));
    fireEvent.click(screen.getByRole('button',{name:'Criar lembrete'}));
    expect(onCreateNote).toHaveBeenCalledWith('reminder');
    fireEvent.click(screen.getByRole('button',{name:'Usar como referência de voz'}));
    expect(onUseVoice).not.toHaveBeenCalled();
    expect(screen.getByText(/substitui sua amostra/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Usar esta gravação'}));
    await waitFor(()=>expect(onUseVoice).toHaveBeenCalledOnce());
    await screen.findByText('Referência de voz atualizada.');
  });
});
