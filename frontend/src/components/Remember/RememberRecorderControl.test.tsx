import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RememberRecorderControl } from './RememberRecorderControl';

vi.mock('../../services/browserRecording', () => ({
  browserRecording: {
    getState: () => ({ phase: 'idle', startedAt: null, message: null, pending: 0 }),
    subscribe: () => () => undefined,
    recover: vi.fn().mockResolvedValue(undefined),
  },
}));

const originalUserAgent = navigator.userAgent;

describe('RememberRecorderControl', () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
  });

  it('abre o gravador nativo quando a linha do tempo está no Android', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'BrainCoreAndroid/1' });
    render(<RememberRecorderControl />);
    expect(screen.getByRole('link', { name: /Gravar neste celular/ })).toHaveAttribute('href', 'braincore://capture');
    expect(screen.queryByRole('button', { name: 'Gravar no PC' })).not.toBeInTheDocument();
  });

  it('oferece gravação pelo microfone do navegador no PC', () => {
    render(<RememberRecorderControl />);
    expect(screen.getByRole('button', { name: 'Gravar no PC' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Gravar neste celular/ })).not.toBeInTheDocument();
  });
});
