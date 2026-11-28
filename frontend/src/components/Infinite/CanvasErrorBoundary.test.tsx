import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('CanvasErrorBoundary', () => {
  it('keeps the app usable when a lazy canvas chunk cannot load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const MissingChunk = () => { throw new TypeError('Failed to fetch dynamically imported module'); };
    render(<CanvasErrorBoundary><MissingChunk /></CanvasErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível abrir o quadro');
    expect(screen.getByRole('button', { name: 'Recarregar aplicativo' })).toBeInTheDocument();
  });
});
