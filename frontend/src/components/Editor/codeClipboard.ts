/** Copy plain code, including whitespace, without changing editor selection. */
export async function copyCodeText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Older WebViews and non-secure LAN origins may need the click fallback.
    }
  }

  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const focused = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('aria-label', 'Código para copiar');
  input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) {
      throw new Error('Clipboard unavailable');
    }
  } finally {
    input.remove();
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}
