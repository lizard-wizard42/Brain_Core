import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

describe('Tabs', () => {
  it('renders bundled inline SVG icons as images instead of spilling URL text', () => {
    const icon = "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%3e%3c/svg%3e";
    const { container, unmount } = render(<Tabs tabs={[{ id: 'remember', title: 'Memória', path: '/remember', icon }]} activeTabId="remember" onTabClick={vi.fn()} onTabClose={vi.fn()} onCloseAllTabs={vi.fn()} onNewTab={vi.fn()} onGoBack={vi.fn()} onGoHome={vi.fn()} />);
    expect(container.querySelector('img')).toHaveAttribute('src', icon);
    expect(container).not.toHaveTextContent('data:image');
    unmount();
  });

  it('renders tabs and triggers click/close callbacks', () => {
    const onTabClick = vi.fn();
    const onTabClose = vi.fn();
    const onGoBack = vi.fn();
    const onGoHome = vi.fn();
    const onCloseAllTabs = vi.fn();

    const { container } = render(
      <Tabs
        tabs={[
          { id: '1', title: 'One', path: '/page/1', icon: '📄' },
          { id: '2', title: 'Two', path: '/page/2', icon: 'https://example.com/i.png' },
        ]}
        activeTabId="1"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onCloseAllTabs={onCloseAllTabs}
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
    fireEvent.click(screen.getByRole('button', { name: 'Fechar todas as abas' }));
    expect(onCloseAllTabs).toHaveBeenCalledOnce();

    expect(container.querySelector('img')).toBeInTheDocument();
  });
});
