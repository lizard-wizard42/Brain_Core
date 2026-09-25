import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { failed: boolean; }

export class RememberErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Remember render error', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="m-6 rounded-2xl border border-red-900/50 bg-red-950/20 p-5 text-red-200">
        <p>Não foi possível carregar a Memória.</p>
        <button type="button" className="mt-4 rounded-xl bg-white/10 px-4 py-2" onClick={() => this.setState({ failed: false })}>
          Tentar novamente
        </button>
      </div>
    );
  }
}
