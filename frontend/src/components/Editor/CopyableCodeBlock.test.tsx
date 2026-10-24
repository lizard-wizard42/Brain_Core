import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { CopyableCodeBlock } from './CopyableCodeBlock';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');
let editor: Editor | null = null;
const code = 'const answer = 42;\n\tconsole.log("Olá 🌎", answer);\n';
function Demo({ editable = true }: { editable?: boolean }) {
  const instance = useEditor({
    extensions: [StarterKit.configure({ codeBlock: false }), CopyableCodeBlock.configure({ lowlight: createLowlight(common) })],
    editable,
    content: { type: 'doc', content: [
      { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: code }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'second block' }] },
    ] },
  });
  useEffect(() => { editor = instance; return () => { if (editor === instance) editor = null; }; }, [instance]);
  return <EditorContent className="tiptap-editor" editor={instance} />;
}

afterEach(() => {
  cleanup(); editor = null; vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalExec) Object.defineProperty(document, 'execCommand', originalExec); else Reflect.deleteProperty(document, 'execCommand');
});

describe('CopyableCodeBlock', () => {
  it('copies only its code, preserves whitespace and document JSON, and keeps highlighting', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<Demo />);
    const buttons = await screen.findAllByRole('button', { name: 'Copiar código' });
    const before = editor!.getJSON();
    expect(buttons[0]).toHaveTextContent('');
    expect(buttons[0]).toHaveAttribute('title', 'Copiar todo o código');
    expect(document.querySelector('pre code .hljs-keyword')).toBeInTheDocument();
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getByText('Código copiado.')).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(code);
    expect(editor!.getJSON()).toEqual(before);
    expect(editor!.getHTML()).not.toMatch(/Copiar|Copiado|button|editor-code/);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('second block'));
  });

  it('works in read-only pages and copies current edited content', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<Demo editable={false} />);
    const button = (await screen.findAllByRole('button', { name: 'Copiar código' }))[0];
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
    act(() => { editor!.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'updated\n  code' }] }] }); });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Copiar código' }))[0]);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('updated\n  code'));
  });

  it('reports failure honestly and lets the user retry', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(false) });
    render(<Demo />);
    const button = (await screen.findAllByRole('button', { name: 'Copiar código' }))[0];
    fireEvent.click(button);
    expect(await screen.findByText('Não foi possível copiar. Tente novamente.')).toBeVisible();
    expect(screen.queryByText('Copiado')).not.toBeInTheDocument();
    writeText.mockResolvedValueOnce(undefined);
    fireEvent.click(button);
    expect(await screen.findByText('Código copiado.')).toBeInTheDocument();
  });
});
