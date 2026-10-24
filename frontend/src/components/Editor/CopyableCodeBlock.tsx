import { useEffect, useRef, useState } from 'react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { copyCodeText } from './codeClipboard';
import './copyableCodeBlock.css';

function CodeBlockView({ node }: NodeViewProps) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const pending = useRef(false);
  const mounted = useRef(true);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(reset.current); };
  }, []);
  useEffect(() => { clearTimeout(reset.current); setStatus('idle'); }, [node.textContent]);

  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    clearTimeout(reset.current);
    setStatus('copying');
    try {
      await copyCodeText(node.textContent);
      if (mounted.current) {
        setStatus('copied');
        reset.current = setTimeout(() => setStatus('idle'), 2000);
      }
    } catch {
      if (mounted.current) setStatus('error');
    } finally {
      pending.current = false;
    }
  };

  return <NodeViewWrapper className="editor-code-block">
    <div className="editor-code-header" contentEditable={false}>
      <button type="button" className="editor-code-copy" aria-label="Copiar código"
        title="Copiar todo o código" disabled={status === 'copying'}
        onMouseDown={event => event.preventDefault()} onClick={() => void copy()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {status === 'copied' ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>}
        </svg>
        <span>{status === 'copied' ? 'Copiado' : status === 'copying' ? 'Copiando…' : 'Copiar'}</span>
      </button>
      <span className={status === 'error' ? 'editor-code-error' : 'sr-only'} role="status" aria-live="polite">
        {status === 'copied' ? 'Código copiado.' : status === 'error' ? 'Não foi possível copiar. Tente novamente.' : ''}
      </span>
    </div>
    <NodeViewContent<'pre'> as="pre" className={node.attrs.language ? `language-${node.attrs.language}` : undefined} style={{ whiteSpace: 'pre' }} />
  </NodeViewWrapper>;
}

// Keep the existing codeBlock schema, parsing and serialization unchanged.
export const CopyableCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, { contentDOMElementTag: 'code' });
  },
});
