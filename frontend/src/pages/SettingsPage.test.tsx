import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { api } from '../api/client';
import { ThemeProvider } from '../theme/ThemeProvider';

type TestWindow = {
  brainCoreNativeBridge?: { _listener?: (event: unknown) => void; [key: string]: unknown };
  ResizeObserver?: unknown;
};

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
  },
}));

vi.mock('../api/client', () => ({
  api: {
    getMe: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    beginTwoFactorSetup: vi.fn(),
    confirmTwoFactorSetup: vi.fn(),
    disableTwoFactor: vi.fn(),
    updateTelegramSettings: vi.fn(),
    listMobileDevices: vi.fn().mockResolvedValue({ devices: [] }),
    listContacts: vi.fn().mockResolvedValue({ contacts: [], incoming: [], outgoing: [] }),
    revokeMobileDevice: vi.fn(),
    getPcAudioRetention: vi.fn().mockResolvedValue({ automatic: false, days: 90 }),
    previewPcAudioCleanup: vi.fn().mockResolvedValue({ files: 0, bytes: 0 }),
    setPcAudioRetention: vi.fn(),
    cleanPcAudio: vi.fn(),
    getTranscriptionPolicy: vi.fn().mockResolvedValue({ mode: 'automatic', start_time: '22:00', window_hours: 8, timezone: 'America/Sao_Paulo', manual_active: 0 }),
    setTranscriptionPolicy: vi.fn(),
    runTranscriptionNow: vi.fn(),
    pauseTranscription: vi.fn(),
  },
}));

const baseUser = {
  id: '1',
  email: 'user@example.com',
  name: 'User',
  telegram_chat_id: null,
  telegram_notifications_enabled: false,
  two_factor_enabled: false,
  two_factor_setup_pending: false,
};

async function renderLoadedPage() {
  vi.mocked(api.getMe).mockResolvedValueOnce(baseUser as never);
  render(<ThemeProvider><SettingsPage /></ThemeProvider>);
  await waitFor(() => expect(screen.getAllByText('user@example.com').length).toBeGreaterThan(0));
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders loaded user info', async () => {
    await renderLoadedPage();
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('mostra ajustes nativos apenas dentro do aplicativo Android', async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${original} BrainCoreAndroid/1` });
    try {
      await renderLoadedPage();
      expect(screen.getByRole('link', { name: 'Abrir ajustes deste aparelho' }))
        .toHaveAttribute('href', 'braincore://device-settings');
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original });
    }
  });

  it('exibe status nativo, blocos pendentes e espaço livre via ponte nativa', async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${original} BrainCoreAndroid/1` });
    (window as unknown as TestWindow).brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const payload = JSON.parse(raw);
        if (payload.action === 'getStatus') {
          setTimeout(() => {
            (window as unknown as TestWindow).brainCoreNativeBridge!._listener?.({
              data: JSON.stringify({
                action: 'status',
                requestId: payload.requestId,
                linked: true,
                deviceId: 'dev-abc',
                linkedUserId: '1',
                recordingOwnerUserId: '1',
                pendingChunks: 4,
                conflictChunks: 0,
                totalSessions: 2,
                totalChunks: 6,
                audioBytes: 4194304,
                freeSpaceBytes: 25000000000,
                isLowSpace: false,
                eligibleCleanupChunks: 3,
                eligibleCleanupBytes: 3145728,
                retentionDays: 30,
                claimableUnowned: 0,
                microphonePermission: 'granted',
              }),
            });
          }, 0);
        }
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        (window as unknown as TestWindow).brainCoreNativeBridge!._listener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    try {
      await renderLoadedPage();
      await waitFor(() => expect(screen.getByText('Vinculado a esta conta')).toBeInTheDocument());
      expect(screen.getByText(/4 bloco\(s\) · 4\.0 MiB/)).toBeInTheDocument();
      expect(screen.getByText(/23\.3 GB livres/)).toBeInTheDocument();
      expect(screen.getByText('Desvincular deste aparelho')).toBeInTheDocument();
    } finally {
      delete (window as unknown as TestWindow).brainCoreNativeBridge;
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original });
    }
  });

  it('exibe alertas para permissão de microfone negada e armazenamento baixo no tablet', async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${original} BrainCoreAndroid/1` });
    (window as unknown as TestWindow).brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const payload = JSON.parse(raw);
        if (payload.action === 'getStatus') {
          setTimeout(() => {
            (window as unknown as TestWindow).brainCoreNativeBridge!._listener?.({
              data: JSON.stringify({
                action: 'status',
                requestId: payload.requestId,
                linked: false,
                deviceId: null,
                linkedUserId: null,
                recordingOwnerUserId: null,
                pendingChunks: 0,
                conflictChunks: 0,
                totalSessions: 0,
                totalChunks: 0,
                audioBytes: 0,
                freeSpaceBytes: 209715200, // ~200 MiB (baixo)
                isLowSpace: true,
                eligibleCleanupChunks: 0,
                eligibleCleanupBytes: 0,
                retentionDays: 30,
                claimableUnowned: 0,
                microphonePermission: 'denied',
              }),
            });
          }, 0);
        }
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        (window as unknown as TestWindow).brainCoreNativeBridge!._listener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    try {
      await renderLoadedPage();
      await waitFor(() => expect(screen.getByText(/Permissão de microfone negada no Android/)).toBeInTheDocument());
      expect(screen.getByText(/Armazenamento baixo no tablet/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Solicitar permissão de microfone' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Vincular gravações a esta conta' })).toBeInTheDocument();
    } finally {
      delete (window as unknown as TestWindow).brainCoreNativeBridge;
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original });
    }
  });

  it('permite vincular pela conta ativa e confirma troca de conta se houver outro proprietário', async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${original} BrainCoreAndroid/1` });
    let linkCallCount = 0;
    (window as unknown as TestWindow).brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const payload = JSON.parse(raw);
        if (payload.action === 'getStatus') {
          setTimeout(() => {
            (window as unknown as TestWindow).brainCoreNativeBridge!._listener?.({
              data: JSON.stringify({
                action: 'status',
                requestId: payload.requestId,
                linked: false,
                deviceId: null,
                linkedUserId: null,
                recordingOwnerUserId: 'outra-conta',
                pendingChunks: 1,
                conflictChunks: 0,
                totalSessions: 1,
                totalChunks: 1,
                audioBytes: 1048576,
                freeSpaceBytes: 20000000000,
                isLowSpace: false,
                eligibleCleanupChunks: 0,
                eligibleCleanupBytes: 0,
                retentionDays: 30,
                claimableUnowned: 0,
                microphonePermission: 'granted',
              }),
            });
          }, 0);
        } else if (payload.action === 'linkDevice') {
          linkCallCount++;
          setTimeout(() => {
            if (!payload.confirmSwitch) {
              (window as unknown as TestWindow).brainCoreNativeBridge!._listener?.({
                data: JSON.stringify({
                  action: 'linkResult',
                  requestId: payload.requestId,
                  success: false,
                  error: 'account_switch_required',
                  message: 'Este aparelho possui gravações de outra conta. Confirme a troca.',
                }),
              });
            } else {
              (window as unknown as TestWindow).brainCoreNativeBridge!._listener?.({
                data: JSON.stringify({
                  action: 'linkResult',
                  requestId: payload.requestId,
                  success: true,
                  deviceId: 'dev-new',
                  userId: '1',
                }),
              });
            }
          }, 0);
        }
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        (window as unknown as TestWindow).brainCoreNativeBridge!._listener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    try {
      await renderLoadedPage();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular gravações a esta conta' })).toBeInTheDocument());

      // Clique 1: tenta vincular, mas recebe account_switch_required
      fireEvent.click(screen.getByRole('button', { name: 'Vincular gravações a esta conta' }));
      await waitFor(() => expect(screen.getByText('Confirmar troca e vincular')).toBeInTheDocument());

      // Clique 2: confirma a troca
      fireEvent.click(screen.getByText('Confirmar troca e vincular'));
      await waitFor(() => expect(screen.getByText('Aparelho vinculado com sucesso a esta conta.')).toBeInTheDocument());
      expect(linkCallCount).toBe(2);
    } finally {
      delete (window as unknown as TestWindow).brainCoreNativeBridge;
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original });
    }
  });

  it('revoga um aparelho de gravação pela conta', async () => {
    vi.mocked(api.listMobileDevices).mockResolvedValueOnce({ devices: [{
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Android de teste',
      created_at: '2026-09-23T00:00:00Z',
      last_used_at: null,
    }] });
    vi.mocked(api.revokeMobileDevice).mockResolvedValueOnce({ revoked: true });
    await renderLoadedPage();
    await waitFor(() => expect(screen.getByText('Android de teste')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(api.revokeMobileDevice).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111'));
    await waitFor(() => expect(screen.queryByText('Android de teste')).not.toBeInTheDocument());
  });

  it('redirects to login when the session expired', async () => {
    vi.mocked(api.getMe).mockRejectedValueOnce(new Error('API 401'));

    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(api.logout).not.toHaveBeenCalled();
  });

  it('shows a retryable error when logout fails', async () => {
    vi.mocked(api.logout).mockRejectedValueOnce(new Error('network'));
    await renderLoadedPage();

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    fireEvent.click(logoutButtons[logoutButtons.length - 1]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar a saída');
    expect(mockNavigate).not.toHaveBeenCalledWith('/login', { replace: true });
  });

  it('calls logout and redirects when clicking sair', async () => {
    vi.mocked(api.logout).mockResolvedValue(undefined as never);
    await renderLoadedPage();

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    fireEvent.click(logoutButtons[logoutButtons.length - 1]);

    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('valida mismatch de senha sem chamar API', async () => {
    await renderLoadedPage();

    const saveButton = screen.getByRole('button', { name: 'Salvar senha' });
    const form = saveButton.closest('form');
    expect(form).toBeTruthy();
    const passwordInputs = form!.querySelectorAll('input[type="password"]');

    fireEvent.change(passwordInputs[0], { target: { value: 'atual' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'nova' } });
    fireEvent.change(passwordInputs[2], { target: { value: 'diferente' } });
    fireEvent.click(saveButton);

    expect(screen.getByText('As senhas não coincidem')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('troca senha com sucesso', async () => {
    vi.mocked(api.changePassword).mockResolvedValueOnce({ ok: true } as never);
    await renderLoadedPage();

    const saveButton = screen.getByRole('button', { name: 'Salvar senha' });
    const form = saveButton.closest('form');
    const passwordInputs = form!.querySelectorAll('input[type="password"]');

    fireEvent.change(passwordInputs[0], { target: { value: 'atual' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'nova123' } });
    fireEvent.change(passwordInputs[2], { target: { value: 'nova123' } });
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('atual', 'nova123'));
    expect(await screen.findByText('Senha alterada com sucesso!')).toBeInTheDocument();
  });

  it('mostra erro ao iniciar setup 2FA', async () => {
    vi.mocked(api.beginTwoFactorSetup).mockRejectedValueOnce(new Error('senha invalida'));
    await renderLoadedPage();

    const beginButton = screen.getByRole('button', { name: 'Ativar 2FA' });
    const form = beginButton.closest('form');
    const passwordInput = form!.querySelector('input[type="password"]') as HTMLInputElement;

    fireEvent.change(passwordInput, { target: { value: '123' } });
    fireEvent.click(beginButton);

    await waitFor(() => expect(screen.getByText('senha invalida')).toBeInTheDocument());
  });

  it('finaliza setup 2FA com sucesso', async () => {
    vi.mocked(api.beginTwoFactorSetup).mockResolvedValueOnce({
      secret: 'SECRETKEY',
      otpauthUri: 'otpauth://totp/brain?secret=SECRETKEY',
    } as never);
    vi.mocked(api.confirmTwoFactorSetup).mockResolvedValueOnce({
      ok: true,
      two_factor_enabled: true,
      two_factor_setup_pending: false,
    } as never);

    await renderLoadedPage();

    const beginButton = screen.getByRole('button', { name: 'Ativar 2FA' });
    const beginForm = beginButton.closest('form');
    const passwordInput = beginForm!.querySelector('input[type="password"]') as HTMLInputElement;

    fireEvent.change(passwordInput, { target: { value: 'senha' } });
    fireEvent.click(beginButton);

    await waitFor(() => expect(screen.getByText('SECRETKEY')).toBeInTheDocument());

    const confirmButton = screen.getByRole('button', { name: 'Confirmar 2FA' });
    const codeInput = screen.getByPlaceholderText('000000');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(api.confirmTwoFactorSetup).toHaveBeenCalledWith('123456'));
    expect(screen.getByText('2FA ativo')).toBeInTheDocument();
  });

  it('salva telegram com sucesso', async () => {
    vi.mocked(api.updateTelegramSettings).mockResolvedValueOnce({
      ...baseUser,
      telegram_chat_id: '999',
      telegram_notifications_enabled: true,
    } as never);

    await renderLoadedPage();

    fireEvent.change(screen.getByPlaceholderText('Ex: 123456789'), { target: { value: '999' } });
    fireEvent.click(screen.getByLabelText('Ativar notificações de lembrete'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Telegram' }));

    await waitFor(() => expect(api.updateTelegramSettings).toHaveBeenCalled());
    expect(vi.mocked(api.updateTelegramSettings).mock.calls[0]?.[1]).toBe(true);
    expect(screen.getByText('Telegram salvo com sucesso.')).toBeInTheDocument();
  });
});
