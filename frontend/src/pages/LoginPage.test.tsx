import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { api } from '../api/client';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../api/client', () => ({
  api: {
    login: vi.fn(),
    verifyLoginTwoFactor: vi.fn(),
    getInitialSetupStatus: vi.fn().mockResolvedValue({ setupRequired: false }),
  },
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to home on successful credential login', async () => {
    vi.mocked(api.login).mockResolvedValueOnce({
      requiresTwoFactor: false,
      expiresIn: '1h',
      user: { id: '1', email: 'u@x.com', name: null },
    } as any);

    const { container } = render(<LoginPage />);
    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'u@x.com' } });
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submitButton);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('shows 2FA step when backend requires two-factor', async () => {
    vi.mocked(api.login).mockResolvedValueOnce({
      requiresTwoFactor: true,
      pendingToken: 'pending-token',
      expiresIn: '5m',
    } as any);

    const { container } = render(<LoginPage />);
    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'u@x.com' } });
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submitButton);

    await waitFor(() => expect(screen.getByText(/CORE_2FA_REQUIRED/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Validar Core' })).toBeInTheDocument();
  });

  it('submits 2FA code and navigates on success', async () => {
    vi.mocked(api.login).mockResolvedValueOnce({
      requiresTwoFactor: true,
      pendingToken: 'pending-token',
      expiresIn: '5m',
    } as any);
    vi.mocked(api.verifyLoginTwoFactor).mockResolvedValueOnce({
      requiresTwoFactor: false,
      expiresIn: '1h',
      user: { id: '1', email: 'u@x.com', name: null },
    } as any);

    const { container } = render(<LoginPage />);
    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'u@x.com' } });
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submitButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Validar Core' })).toBeInTheDocument());
    const codeInput = container.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: '123456' } });
    const verifySubmitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(verifySubmitButton);

    await waitFor(() => expect(api.verifyLoginTwoFactor).toHaveBeenCalledWith('pending-token', '123456', true));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('maps credential errors to core error message', async () => {
    vi.mocked(api.login).mockRejectedValueOnce(new Error('Credenciais inválidas'));

    const { container } = render(<LoginPage />);
    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'u@x.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(submitButton);

    await waitFor(() => expect(screen.getByText(/CORE_AUTH_401/i)).toBeInTheDocument());
  });
});
