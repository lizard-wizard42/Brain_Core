import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RememberSpeakersButton } from './RememberSpeakersPanel';
import { rememberService } from '../../services/rememberService';

vi.mock('../../services/rememberService', () => ({
  rememberService: {
    setCluster: vi.fn().mockResolvedValue({ status: 'confirmed' }),
    getPeople: vi.fn().mockResolvedValue([]),
    backfillSpeakers: vi.fn().mockResolvedValue({ embedded: 2, missing_chunks: 0 }),
    clusterSampleUrl: vi.fn((ids: number[]) => `/api/remember/memory/segments/audio?ids=${ids.join(',')}`),
    segmentAudioUrl: (id: number) => `/api/remember/memory/segments/${id}/audio`,
    renamePerson: vi.fn().mockResolvedValue({}),
    mergePeople: vi.fn().mockResolvedValue({}),
    deletePerson: vi.fn().mockResolvedValue({ deleted: true }),
  },
}));

const cl = (o: any) => ({
  cluster: 1, status: 'pending', person_id: null, name: null, is_me: false,
  suggested: null, sample_segment_id: 11, total_ms: 5000, turn_count: 3, ...o,
});
const day = (sessions: any[]) => ({ date: '2026-08-20', total_seconds: 0, session_count: sessions.length, sessions });
const session = (speakers: any[] | undefined) => ({
  id: 's1', started_at: '2026-08-20T09:00:00Z', ended_at: null, device_id: null, status: 'ready', text: null, speakers,
});

describe('RememberSpeakersButton', () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('badge mostra a contagem de clusters pending; some com 0', () => {
    const { rerender } = render(<RememberSpeakersButton day={day([session([cl({ cluster: 1 }), cl({ cluster: 2 })])])} onChanged={vi.fn()} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    rerender(<RememberSpeakersButton day={day([session([cl({ cluster: 2, status: 'confirmed', person_id: 5, name: 'X' })])])} onChanged={vi.fn()} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('atualiza o dia ao abrir para buscar clusters concluídos em segundo plano', () => {
    const onChanged = vi.fn();
    render(<RememberSpeakersButton day={day([session([])])} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('o cluster mostra um botão por trecho e cada um toca isolado', async () => {
    const audio = {
      paused: true, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
      currentTime: 0, onerror: null,
    };
    const AudioMock = vi.fn(function AudioMock() { return audio; });
    vi.stubGlobal('Audio', AudioMock);
    render(<RememberSpeakersButton
      day={day([session([cl({ sample_segment_id: 11, sample_segment_ids: [21, 22, 23] })])])}
      onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    expect(await screen.findByTitle('Ouvir trecho 1')).toBeInTheDocument();
    expect(screen.getByTitle('Ouvir trecho 3')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Ouvir trecho 2'));
    expect(AudioMock).toHaveBeenCalledWith('/api/remember/memory/segments/22/audio');
  });

  it('cluster com 1 trecho só → botão único', async () => {
    render(<RememberSpeakersButton
      day={day([session([cl({ sample_segment_id: 11, sample_segment_ids: [11] })])])}
      onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    expect(await screen.findByTitle(/ouvir um trecho/i)).toBeInTheDocument();
    expect(screen.queryByTitle('Ouvir trecho 2')).not.toBeInTheDocument();
  });

  it('confirmar a sugestão chama setCluster confirm_person', async () => {
    const onChanged = vi.fn();
    render(<RememberSpeakersButton
      day={day([session([cl({ cluster: 1, suggested: { person_id: 7, name: 'Cláudio', score: 0.72 } })])])}
      onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirmar/i }));
    await waitFor(() => expect(rememberService.setCluster).toHaveBeenCalledWith('s1', 1, 'confirm_person', { personId: 7 }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('"Nome novo" chama setCluster confirm_new com o nome', async () => {
    render(<RememberSpeakersButton day={day([session([cl({ cluster: 1 })])])} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /nome novo/i }));
    fireEvent.change(screen.getByPlaceholderText(/nome/i), { target: { value: 'Tio Zé' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$|salvar|confirmar nome/i }));
    await waitFor(() => expect(rememberService.setCluster).toHaveBeenCalledWith('s1', 1, 'confirm_new', { name: 'Tio Zé' }));
  });

  it('"Sou eu" → set_me; "Não é ninguém" → reject', async () => {
    render(<RememberSpeakersButton day={day([session([cl({ cluster: 1 })])])} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sou eu/i }));
    await waitFor(() => expect(rememberService.setCluster).toHaveBeenCalledWith('s1', 1, 'set_me', undefined));
  });

  it('sessão sem speakers → botão "Processar falantes" chama backfillSpeakers', async () => {
    const onChanged = vi.fn();
    render(<RememberSpeakersButton day={day([session(undefined)])} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /processar falantes/i }));
    await waitFor(() => expect(rememberService.backfillSpeakers).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('busca /people uma única vez ao abrir o drawer', async () => {
    render(<RememberSpeakersButton day={null} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    await waitFor(() => expect(rememberService.getPeople).toHaveBeenCalledTimes(1));
  });

  it('"Processar falantes": uma sessão falha, as demais seguem e onChanged é chamado', async () => {
    vi.mocked(rememberService.backfillSpeakers)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ embedded: 3, missing_chunks: 0 });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onChanged = vi.fn();
    const d = day([{ ...session(undefined), id: 'sa' }, { ...session(undefined), id: 'sb' }]);
    render(<RememberSpeakersButton day={d} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /processar falantes/i }));
    await waitFor(() => expect(rememberService.backfillSpeakers).toHaveBeenCalledWith('sa'));
    await waitFor(() => expect(rememberService.backfillSpeakers).toHaveBeenCalledWith('sb'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('aba Pessoas: getPeople rejeita → mostra "não disponível", não "Nenhuma pessoa"', async () => {
    vi.mocked(rememberService.getPeople).mockRejectedValueOnce(new Error('HTTP 404'));
    render(<RememberSpeakersButton day={null} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pessoas/i }));
    expect(await screen.findByText(/não disponível nesta versão do app android/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma pessoa ainda/i)).not.toBeInTheDocument();
  });

  it('aba Pessoas: renomear chama renamePerson; apagar chama deletePerson; is_me sem ações', async () => {
    vi.mocked(rememberService.getPeople).mockResolvedValue([
      { id: 1, name: 'Você', is_me: true, sample_seconds: 30, segment_count: 10, session_count: 3, sample_segment_id: 5, updated_at: '' },
      { id: 2, name: 'Cláudio', is_me: false, sample_seconds: 12, segment_count: 4, session_count: 2, sample_segment_id: 8, updated_at: '' },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RememberSpeakersButton day={null} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pessoas/i }));

    const claudio = await screen.findByText('Cláudio');
    fireEvent.click(claudio);
    fireEvent.change(screen.getByDisplayValue('Cláudio'), { target: { value: 'Pessoa Teste' } });
    fireEvent.blur(screen.getByDisplayValue('Pessoa Teste'));
    await waitFor(() => expect(rememberService.renamePerson).toHaveBeenCalledWith(2, 'Pessoa Teste'));

    fireEvent.click(screen.getAllByRole('button', { name: /apagar/i })[0]);
    await waitFor(() => expect(rememberService.deletePerson).toHaveBeenCalledWith(2));

    // a linha do "Você" (is_me) não tem apagar/juntar
    const rows = screen.getAllByTestId('person-row');
    const meRow = rows.find((r) => r.textContent?.includes('Você'))!;
    expect(meRow.querySelector('button[aria-label="Apagar"]')).toBeNull();
  });

  it('aba Pessoas: mostra os 3 trechos da pessoa, cada um isolado', async () => {
    const audio = {
      paused: true, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
      currentTime: 0, onerror: null,
    };
    const AudioMock = vi.fn(function AudioMock() { return audio; });
    vi.stubGlobal('Audio', AudioMock);
    vi.mocked(rememberService.getPeople).mockResolvedValue([
      { id: 2, name: 'Cláudio', is_me: false, sample_seconds: 12, segment_count: 4,
        session_count: 2, sample_segment_id: 8, sample_segment_ids: [8, 15, 27], updated_at: '' },
    ]);
    render(<RememberSpeakersButton day={null} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pessoas/i }));
    await screen.findByText('Cláudio');
    fireEvent.click(screen.getByTitle('Ouvir trecho 3'));
    expect(AudioMock).toHaveBeenCalledWith('/api/remember/memory/segments/27/audio');
  });

  it('aba Pessoas: juntar chama mergePeople(into=esta, from=escolhida)', async () => {
    vi.mocked(rememberService.getPeople).mockResolvedValue([
      { id: 2, name: 'Cláudio', is_me: false, sample_seconds: 12, segment_count: 4, session_count: 2, sample_segment_id: 8, updated_at: '' },
      { id: 3, name: 'Cláudião', is_me: false, sample_seconds: 4, segment_count: 1, session_count: 1, sample_segment_id: 9, updated_at: '' },
    ]);
    render(<RememberSpeakersButton day={null} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /falantes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pessoas/i }));
    const joinBtns = await screen.findAllByRole('button', { name: /juntar/i });
    fireEvent.click(joinBtns[0]); // na linha do Cláudio (id 2)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await waitFor(() => expect(rememberService.mergePeople).toHaveBeenCalledWith(2, 3));
  });
});
