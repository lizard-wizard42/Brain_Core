import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RememberVoiceprintPanel } from './RememberVoiceprintPanel';
import { rememberService } from '../../services/rememberService';
import { browserRecording } from '../../services/browserRecording';
import * as nativeBridge from '../../services/nativeBridge';

vi.mock('../../services/rememberService', () => ({
  rememberService: {
    getVoiceprint: vi.fn(),
    enrollVoiceprint: vi.fn(),
    deleteVoiceprint: vi.fn(),
  },
}));
vi.mock('../../services/nativeBridge', () => ({
  isNativeAndroidApp: vi.fn(() => false),
  isNativeBridgeAvailable: vi.fn(() => false),
  getNativeStatus: vi.fn(),
  startNativeVoiceSample: vi.fn(),
  stopNativeVoiceSample: vi.fn(),
  cancelNativeVoiceSample: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(nativeBridge.isNativeAndroidApp).mockReturnValue(false);
  vi.mocked(nativeBridge.isNativeBridgeAvailable).mockReturnValue(false);
  vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
});
afterEach(() => cleanup());

describe('RememberVoiceprintPanel', () => {
  it('mostra a reclassificação pendente e atualiza a timeline quando a fila termina', async () => {
    const onRelabelChange = vi.fn();
    vi.mocked(rememberService.getVoiceprint)
      .mockResolvedValueOnce({ enrolled: true, updated_at: null, sample_seconds: 29.9, model: 'campplus', relabel: { pending: 1, processing: 0, failed: 0 } })
      .mockResolvedValueOnce({ enrolled: true, updated_at: null, sample_seconds: 29.9, model: 'campplus', relabel: { pending: 0, processing: 0, failed: 0 } });
    const interval = vi.spyOn(window, 'setInterval');
    try {
      render(<RememberVoiceprintPanel onRelabelChange={onRelabelChange} />);
      await waitFor(() => expect(rememberService.getVoiceprint).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Atualizando 1 bloco'));
      const poll = interval.mock.calls.find((call) => call[1] === 5000)?.[0] as (() => void) | undefined;
      expect(poll).toBeDefined();
      await act(async () => { poll?.(); });
      await waitFor(() => expect(onRelabelChange).toHaveBeenCalledOnce());
      expect(screen.queryByText(/Reclassificando 1 bloco/)).not.toBeInTheDocument();
    } finally { interval.mockRestore(); }
  });
  it('no Android grava pelo bridge nativo sem abrir outro aplicativo nem usar getUserMedia', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    vi.mocked(nativeBridge.isNativeAndroidApp).mockReturnValue(true);
    vi.mocked(nativeBridge.isNativeBridgeAvailable).mockReturnValue(true);
    vi.mocked(nativeBridge.getNativeStatus).mockResolvedValue({ microphonePermission: 'granted', nativeRecordingActive: false } as nativeBridge.NativeDeviceStatus);
    vi.mocked(nativeBridge.startNativeVoiceSample).mockResolvedValue({ success: true });
    vi.mocked(nativeBridge.stopNativeVoiceSample).mockResolvedValue({ success: true });
    const oldMediaDevices = navigator.mediaDevices;
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    try {
      render(<RememberVoiceprintPanel />);
      await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Gravar minha voz' }));
      await waitFor(() => expect(nativeBridge.startNativeVoiceSample).toHaveBeenCalledOnce());
      expect(getUserMedia).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Parar e enviar' }));
      await waitFor(() => expect(nativeBridge.stopNativeVoiceSample).toHaveBeenCalledOnce());
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: oldMediaDevices });
    }
  });
  it('mostra "não configurada" e o botão de gravar quando não há voiceprint', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
    expect(screen.getByRole('button', { name: 'Gravar minha voz' })).toBeInTheDocument();
  });

  it('mostra estado configurado e permite remover', async () => {
    vi.mocked(rememberService.getVoiceprint)
      .mockResolvedValueOnce({ enrolled: true, updated_at: '2026-08-27T10:00:00Z', sample_seconds: 20, model: 'campplus' })
      .mockResolvedValueOnce({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    vi.mocked(rememberService.deleteVoiceprint).mockResolvedValue({ enrolled: false });
    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(rememberService.deleteVoiceprint).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
  });

  it('avisa quando o navegador não permite gravar', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gravar minha voz' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/não permite gravar/i));
    Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true });
  });

  it('orienta o usuário com mensagem detalhada quando a permissão de microfone é negada', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    const originalMediaDevices = navigator.mediaDevices;
    const originalMediaRecorder = window.MediaRecorder;
    const mockGetUserMedia = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      configurable: true,
    });
    window.MediaRecorder = class {} as unknown as typeof MediaRecorder;

    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gravar minha voz' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Permissão de microfone negada/i));
    expect(screen.getByRole('alert')).toHaveTextContent(/Enviar arquivo de áudio/i);

    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
    window.MediaRecorder = originalMediaRecorder;
  });

  it('não inicia outra captura durante uma gravação do próprio Brain Core', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    const state = vi.spyOn(browserRecording, 'getState').mockReturnValue({ phase: 'recording', startedAt: null, message: null, pending: 0, unassigned: 0 });
    try {
      render(<RememberVoiceprintPanel />);
      await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Gravar minha voz' }));
      expect(screen.getByRole('alert')).toHaveTextContent('O Brain Core já está gravando nesta página');
    } finally {
      state.mockRestore();
    }
  });

  it('explica que o microfone está indisponível sem acusar outro aplicativo como causa certa', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    const originalMediaDevices = navigator.mediaDevices;
    const originalRecorder = window.MediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('Could not start audio source', 'NotReadableError')),
    } });
    window.MediaRecorder = class {} as unknown as typeof MediaRecorder;
    try {
      render(<RememberVoiceprintPanel />);
      await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Gravar minha voz' }));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('O microfone não pôde ser iniciado'));
      expect(screen.getByRole('alert')).toHaveTextContent('outra gravação ou chamada ativa');
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
      window.MediaRecorder = originalRecorder;
    }
  });

  it('permite configurar a voz enviando um arquivo de áudio diretamente', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    vi.mocked(rememberService.enrollVoiceprint).mockResolvedValue({ enrolled: true, sample_seconds: 15, model: 'campplus' });
    render(<RememberVoiceprintPanel />);
    await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));

    const fileInput = screen.getByLabelText('Upload de amostra de voz');
    const audioBlob = new File(['dummy audio content'], 'minha-voz.wav', { type: 'audio/wav' });
    fireEvent.change(fileInput, { target: { files: [audioBlob] } });

    await waitFor(() => expect(rememberService.enrollVoiceprint).toHaveBeenCalledWith(audioBlob));
  });

  it('envia a amostra ao completar 30 segundos sem usar tempo antigo', async () => {
    vi.mocked(rememberService.getVoiceprint).mockResolvedValue({ enrolled: false, updated_at: null, sample_seconds: null, model: null });
    vi.mocked(rememberService.enrollVoiceprint).mockResolvedValue({ enrolled: true, sample_seconds: 30, model: 'campplus' });
    const originalMediaDevices = navigator.mediaDevices;
    const originalRecorder = window.MediaRecorder;
    const track = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    class Recorder {
      state = 'recording';
      stream = { getTracks: () => [track] };
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {}
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    window.MediaRecorder = Recorder as unknown as typeof MediaRecorder;
    try {
      render(<RememberVoiceprintPanel />);
      await waitFor(() => expect(screen.getByText('não configurada')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Minha voz/ }));
      vi.useFakeTimers();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Gravar minha voz' })); });
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(rememberService.enrollVoiceprint).toHaveBeenCalledWith(expect.any(Blob));
      expect(track.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
      window.MediaRecorder = originalRecorder;
    }
  });
});
