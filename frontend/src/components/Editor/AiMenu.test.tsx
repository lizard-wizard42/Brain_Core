import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiMenu } from './AiMenu';

function fakeEditor(doc: any) {
  const run = vi.fn();
  const setContent = vi.fn(() => ({ run }));
  const chain = vi.fn(() => ({ setContent }));
  return { getJSON: () => doc, chain, _spies: { setContent, run } } as any;
}

const messyDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'B' }] },
    { type: 'paragraph' },
    { type: 'paragraph' },
  ],
};

describe('AiMenu', () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ''; });

  it('"Arrumar (rápido)" normaliza o doc e chama setContent', () => {
    const editor = fakeEditor(messyDoc);
    render(<AiMenu editor={editor} pageId="p1" />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'IA' }));
    fireEvent.click(screen.getByText('Arrumar (rápido)'));
    expect(editor._spies.setContent).toHaveBeenCalledTimes(1);
    const applied = editor._spies.setContent.mock.calls[0][0];
    expect(applied.content.map((n: any) => n.attrs?.level ?? null)).toEqual([1, 2]);
  });

  it('o menu abre via portal fora do container (não é recortado pelo toolbar)', () => {
    const editor = fakeEditor({ type: 'doc', content: [] });
    const { container } = render(<AiMenu editor={editor} pageId="p1" />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'IA' }));
    const item = screen.getByText('Arrumar (rápido)');
    expect(item).toBeInTheDocument();
    // renderizado via portal em document.body, não dentro do próprio componente
    // (senão o `overflow-x-auto` do toolbar recorta o dropdown e ele "não abre")
    expect(container.contains(item)).toBe(false);
    const panel = item.closest('div');
    expect(panel && panel.parentElement === document.body).toBe(true);
  });

  it('doc já organizado → não chama setContent, mostra "Nada a arrumar"', () => {
    const clean = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A' }] }] };
    const editor = fakeEditor(clean);
    render(<AiMenu editor={editor} pageId="p1" />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'IA' }));
    fireEvent.click(screen.getByText('Arrumar (rápido)'));
    expect(editor._spies.setContent).not.toHaveBeenCalled();
    expect(screen.getByText('Nada a arrumar')).toBeInTheDocument();
  });

  it('IA desabilitada quando o backend diz enabled=false', async () => {
    const editor = fakeEditor({ type: 'doc', content: [] });
    render(<AiMenu editor={editor} pageId="p1" checkAiEnabled={() => Promise.resolve(false)} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'IA' }));
    const btn = await screen.findByText('Reorganizar com IA');
    expect(btn).toBeDisabled();
  });

  it('fluxo IA: serializa, chama API, aplica setContent e faz snapshot', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'oi' }] }] };
    const editor = fakeEditor(doc);
    const organizeViaApi = vi.fn().mockResolvedValue({ markdown: '## Oi' });
    const snapshotVersion = vi.fn().mockResolvedValue(undefined);
    render(
      <AiMenu editor={editor} pageId="p1"
        checkAiEnabled={() => Promise.resolve(true)}
        organizeViaApi={organizeViaApi}
        snapshotVersion={snapshotVersion} />,
    );
    fireEvent.mouseDown(screen.getByRole('button', { name: 'IA' }));
    fireEvent.click(await screen.findByText('Reorganizar com IA'));
    await vi.waitFor(() => expect(editor._spies.setContent).toHaveBeenCalledTimes(1));
    expect(organizeViaApi).toHaveBeenCalledWith('p1', expect.any(String));
    expect(snapshotVersion).toHaveBeenCalledWith('p1', 'ia');
  });

  it('erro da API não altera o doc', async () => {
    const editor = fakeEditor({ type: 'doc', content: [] });
    render(
      <AiMenu editor={editor} pageId="p1"
        checkAiEnabled={() => Promise.resolve(true)}
        organizeViaApi={() => Promise.reject(new Error('API 502: x'))} />,
    );
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    fireEvent.mouseDown(screen.getByRole('button', { name: 'IA' }));
    fireEvent.click(await screen.findByText('Reorganizar com IA'));
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(editor._spies.setContent).not.toHaveBeenCalled();
  });

  it('IA que descarta um token de bloco anexado → não aplica e alerta', async () => {
    const attach = { type: 'attachmentBlock', attrs: { url: '/u/x.pdf', name: 'x.pdf' } };
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'oi' }] },
      attach,
    ] };
    const editor = fakeEditor(doc);
    const organizeViaApi = vi.fn().mockResolvedValue({ markdown: '## Reorganizado sem o token' });
    const snapshotVersion = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(
      <AiMenu editor={editor} pageId="p1"
        checkAiEnabled={() => Promise.resolve(true)}
        organizeViaApi={organizeViaApi}
        snapshotVersion={snapshotVersion} />,
    );
    fireEvent.mouseDown(screen.getByRole('button', { name: 'IA' }));
    fireEvent.click(await screen.findByText('Reorganizar com IA'));
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(editor._spies.setContent).not.toHaveBeenCalled();
    expect(snapshotVersion).not.toHaveBeenCalled();
  });
});
