import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { api } from '../api/client';

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
  vi.mocked(api.getMe).mockResolvedValueOnce(baseUser as any);
  render(<SettingsPage />);
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

  it('redirects to login when getMe fails', async () => {
    vi.mocked(api.getMe).mockRejectedValueOnce(new Error('401'));
    vi.mocked(api.logout).mockResolvedValueOnce(undefined as any);

    render(<SettingsPage />);

    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('calls logout and redirects when clicking sair', async () => {
    vi.mocked(api.logout).mockResolvedValue(undefined as any);
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
    vi.mocked(api.changePassword).mockResolvedValueOnce({ ok: true } as any);
    await renderLoadedPage();

    const saveButton = screen.getByRole('button', { name: 'Salvar senha' });
    const form = saveButton.closest('form');
    const passwordInputs = form!.querySelectorAll('input[type="password"]');

    fireEvent.change(passwordInputs[0], { target: { value: 'atual' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'nova123' } });
    fireEvent.change(passwordInputs[2], { target: { value: 'nova123' } });
    fireEvent.click(saveButton);

    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('atual', 'nova123'));
    expect(screen.getByText('Senha alterada com sucesso!')).toBeInTheDocument();
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
    } as any);
    vi.mocked(api.confirmTwoFactorSetup).mockResolvedValueOnce({
      ok: true,
      two_factor_enabled: true,
      two_factor_setup_pending: false,
    } as any);

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
    } as any);

    await renderLoadedPage();

    fireEvent.change(screen.getByPlaceholderText('Ex: 123456789'), { target: { value: '999' } });
    fireEvent.click(screen.getByLabelText('Ativar notificações de lembrete'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Telegram' }));

    await waitFor(() => expect(api.updateTelegramSettings).toHaveBeenCalled());
    expect(vi.mocked(api.updateTelegramSettings).mock.calls[0]?.[1]).toBe(true);
    expect(screen.getByText('Telegram salvo com sucesso.')).toBeInTheDocument();
  });
});
