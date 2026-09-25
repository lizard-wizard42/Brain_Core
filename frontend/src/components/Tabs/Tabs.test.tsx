import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

describe('Tabs', () => {
  it('renders tabs and triggers click/close callbacks', () => {
    const onTabClick = vi.fn();
    const onTabClose = vi.fn();
    const onGoBack = vi.fn();
    const onGoHome = vi.fn();

    const { container } = render(
      <Tabs
        tabs={[
          { id: '1', title: 'One', path: '/page/1', icon: '📄' },
          { id: '2', title: 'Two', path: '/page/2', icon: 'https://example.com/i.png' },
        ]}
        activeTabId="1"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onNewTab={vi.fn()}
        onGoBack={onGoBack}
        onGoHome={onGoHome}
      />
    );

    fireEvent.click(screen.getByText('One'));
    expect(onTabClick).toHaveBeenCalledWith('1');

    fireEvent.click(screen.getByLabelText('Fechar One'));
    expect(onTabClose).toHaveBeenCalledWith('1', expect.any(Object));

    fireEvent.click(screen.getByLabelText('Voltar'));
    fireEvent.click(screen.getByLabelText('Ir para o dashboard'));
    expect(onGoBack).toHaveBeenCalledOnce();
    expect(onGoHome).toHaveBeenCalledOnce();

    expect(container.querySelector('img')).toBeInTheDocument();
  });
});
