import { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { PdfViewer } from '../Viewer/PdfViewer';
import { resolveAssetUrl } from '../../api/assetUrl';

function normalizeAttachmentName(name: string): string {
  if (!name) return 'Arquivo';
  if (!/[ÃÂâ]/.test(name)) return name;

  try {
    const bytes = Uint8Array.from(name, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch {
    return name;
  }
}

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function attachmentIcon(name: string, mimeType: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mimeType.includes('pdf') || ext === 'pdf') return '📕';
  if (mimeType.includes('word') || ext === 'doc' || ext === 'docx' || ext === 'odt' || ext === 'rtf' || ext === 'txt') return '📘';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || ext === 'xls' || ext === 'xlsx' || ext === 'csv' || ext === 'ods') return '📗';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation') || ext === 'ppt' || ext === 'pptx') return '📙';
  return '📎';
}

export function AttachmentBlockView({ node, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as { url: string; name: string; size?: number; mimeType?: string };
  const rawUrl = attrs.url ?? '';
  const url = resolveAssetUrl(rawUrl);
  const name = normalizeAttachmentName(attrs.name ?? 'Arquivo');
  const size = Number(attrs.size ?? 0);
  const mimeType = attrs.mimeType ?? '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const urlExt = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? '';
  const isPdf = mimeType.includes('pdf') || ext === 'pdf' || urlExt === 'pdf';
  const [showPreview, setShowPreview] = useState(false);

  const handleOpen = () => {
    if (isPdf) {
      setShowPreview(v => !v);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <NodeViewWrapper>
      <div
        className="my-1 flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#1e1e1e] hover:border-[#333] transition-colors group"
        contentEditable={false}
      >
        <span className="text-base shrink-0">{attachmentIcon(name, mimeType)}</span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-[#d4d4d4] truncate">{name}</p>
          <p className="text-[11px] text-gray-600 truncate">{formatSize(size)}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            title={isPdf ? 'Visualizar PDF' : 'Abrir arquivo'}
            className="px-2 py-1 text-[11px] rounded text-gray-400 hover:text-gray-100 hover:bg-white/5 transition-colors"
            onClick={handleOpen}
          >
            {isPdf ? (showPreview ? 'Fechar' : 'Visualizar') : 'Abrir'}
          </button>
          <button
            title="Baixar arquivo"
            className="px-2 py-1 text-[11px] rounded text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
            onClick={handleDownload}
          >
            Baixar
          </button>
          <button
            title="Remover anexo"
            className="w-5 h-5 text-[11px] rounded text-gray-600 hover:text-red-400 hover:bg-white/5 transition-colors"
            onClick={() => deleteNode()}
          >
            ✕
          </button>
        </div>
      </div>
      {isPdf && showPreview && (
        <div className="mt-2 rounded-lg border border-[#2a2a2a] overflow-hidden" contentEditable={false}>
          <PdfViewer url={url} title={name} />
        </div>
      )}
    </NodeViewWrapper>
  );
}
