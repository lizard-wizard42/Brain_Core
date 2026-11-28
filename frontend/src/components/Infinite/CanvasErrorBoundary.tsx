import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Keeps a missing lazy chunk from replacing the entire app with a blank page. */
export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.error('Canvas failed to load', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--theme-muted)]">
      <p>Não foi possível abrir o quadro. Uma atualização do aplicativo pode ter substituído os arquivos carregados nesta janela.</p>
      <button type="button" className="rounded-lg bg-[var(--theme-primary)] px-4 py-2 text-white" onClick={() => {
        const target = new URL(window.location.href);
        target.searchParams.set('_brain_refresh', String(Date.now()));
        window.location.replace(target.href);
      }}>
        Recarregar aplicativo
      </button>
    </div>;
  }
}
