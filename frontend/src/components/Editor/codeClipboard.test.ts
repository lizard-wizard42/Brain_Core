import { afterEach, expect, it, vi } from 'vitest';
import { copyCodeText } from './codeClipboard';

const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalExec) Object.defineProperty(document, 'execCommand', originalExec); else Reflect.deleteProperty(document, 'execCommand');
});
it('falls back on LAN origins, preserving the exact text, focus and selection', async () => {
  vi.stubGlobal('navigator', { clipboard: undefined });
  const input = document.createElement('button'); input.textContent = 'Editor'; document.body.appendChild(input); input.focus();
  const range = document.createRange(); range.selectNodeContents(input); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const exec = vi.fn(() => { expect((document.activeElement as HTMLTextAreaElement).value).toBe('\talpha\n  beta\n'); return true; });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
  await copyCodeText('\talpha\n  beta\n');
  expect(exec).toHaveBeenCalledWith('copy');
  expect(document.activeElement).toBe(input);
  expect(selection.toString()).toBe('Editor');
  expect(document.querySelector('textarea')).not.toBeInTheDocument();
});
it('cleans up even when both clipboard methods fail', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(false) });
  await expect(copyCodeText('code')).rejects.toThrow('Clipboard unavailable');
  expect(document.querySelector('textarea')).not.toBeInTheDocument();
});
