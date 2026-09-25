import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RememberSidebarTree } from './RememberSidebarTree';
import { rememberService } from '../../services/rememberService';

vi.mock('../../services/rememberService', () => ({
  rememberService: {
    getStatus: vi.fn(),
    getYears: vi.fn(),
    getMonths: vi.fn(),
    getDays: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rememberService.getStatus).mockResolvedValue({
    state: 'stopped', started_at: null, last_communication_at: null, device_id: null,
  } as never);
});
afterEach(() => cleanup());

describe('RememberSidebarTree — "Linha do tempo"', () => {
  it('clique esquerdo abre no mesmo lugar (sem flag de nova aba)', async () => {
    const onOpen = vi.fn();
    render(<RememberSidebarTree onOpen={onOpen} />);
    const btn = await screen.findByRole('button', { name: /linha do tempo/i });

    fireEvent.click(btn);

    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    // Sem segundo argumento verdadeiro → não é "nova aba".
    expect(onOpen.mock.calls.every((args) => args[1] !== true)).toBe(true);
  });

  it('clique do meio (botão do meio do mouse) abre em nova aba', async () => {
    const onOpen = vi.fn();
    render(<RememberSidebarTree onOpen={onOpen} />);
    const btn = await screen.findByRole('button', { name: /linha do tempo/i });

    fireEvent.mouseDown(btn, { button: 1 });

    expect(onOpen).toHaveBeenCalledWith(undefined, true);
  });
});
