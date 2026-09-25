import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupPage } from './SetupPage';
import { api } from '../api/client';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../api/client', () => ({
  api: {
    getInitialSetupStatus: vi.fn(),
    completeInitialSetup: vi.fn(),
  },
}));

describe('SetupPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getInitialSetupStatus).mockResolvedValue({ setupRequired: true });
  });

  it('creates the first administrator and opens the app', async () => {
    vi.mocked(api.completeInitialSetup).mockResolvedValue({
      user: { id: 'admin', email: 'admin@example.test', name: 'Admin' },
      expiresIn: '12h',
    });

    render(<SetupPage />);
    await screen.findByRole('heading', { name: 'Bem-vindo ao Brain Core' });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Admin' } });
    fireEvent.change(inputs[1], { target: { value: 'admin@example.test' } });
    const passwords = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0], { target: { value: 'senha-forte-123' } });
    fireEvent.change(passwords[1], { target: { value: 'senha-forte-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar conta/i }));

    await waitFor(() => expect(api.completeInitialSetup).toHaveBeenCalledWith('Admin', 'admin@example.test', 'senha-forte-123'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('does not submit mismatched passwords', async () => {
    render(<SetupPage />);
    await screen.findByRole('heading', { name: 'Bem-vindo ao Brain Core' });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Admin' } });
    fireEvent.change(inputs[1], { target: { value: 'admin@example.test' } });
    const passwords = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0], { target: { value: 'senha-forte-123' } });
    fireEvent.change(passwords[1], { target: { value: 'outra-senha-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar conta/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas precisam ser iguais.');
    expect(api.completeInitialSetup).not.toHaveBeenCalled();
  });
});
