import { useRef, useState } from 'react';
import { api } from '../../api/client';

export interface CoverProps {
  pageId: string;
  coverUrl: string | null | undefined;
  coverPositionY: number;
  onUpdate: (url: string | null, posY?: number) => void;
}

export function CoverImage({ pageId, coverUrl, coverPositionY, onUpdate }: CoverProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [repositioning, setRepositioning] = useState(false);
  const [posY, setPosY] = useState(coverPositionY);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartPosY = useRef<number>(posY);

  const handleUrlSave = async () => {
    if (!urlInput.trim()) return;
    try {
      const updated = await api.patchPage(pageId, { cover_url: urlInput.trim() });
      onUpdate(updated.cover_url ?? null, updated.cover_position_y ?? 50);
      setShowPanel(false);
      setUrlInput('');
    } catch {
      alert('Erro ao salvar capa');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-uploaded
    try {
      const updated = await api.uploadCover(pageId, file);
      onUpdate(updated.cover_url ?? null, updated.cover_position_y ?? 50);
      setShowPanel(false);
    } catch {
      alert('Erro ao fazer upload');
    }
  };

  const handleRemove = async () => {
    try {
      await api.removeCover(pageId);
      onUpdate(null);
      setShowPanel(false);
    } catch {
      alert('Erro ao remover capa');
    }
  };

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartPosY.current = posY;

    const onMove = (ev: MouseEvent) => {
      if (dragStartY.current === null || !imgContainerRef.current) return;
      const containerH = imgContainerRef.current.clientHeight;
      const delta = ev.clientY - dragStartY.current;
      const deltaPercent = (delta / containerH) * 100;
      setPosY(Math.max(0, Math.min(100, dragStartPosY.current - deltaPercent)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragStartY.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleSavePosition = async () => {
    setRepositioning(false);
    try {
      await api.patchPage(pageId, { cover_position_y: Math.round(posY) });
      onUpdate(coverUrl ?? null, Math.round(posY));
    } catch { /* silent */ }
  };

  if (!coverUrl) {
    return (
      <div className="group relative h-8 flex items-center">
        <button
          className="flex md:hidden md:group-hover:flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors ml-2"
          onClick={() => setShowPanel(true)}
        >
          <span>🖼️</span> Adicionar capa
        </button>
        {showPanel && (
          <CoverPanel
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            onUrlSave={handleUrlSave}
            onFileClick={() => fileRef.current?.click()}
            onRemove={undefined}
            onClose={() => setShowPanel(false)}
          />
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
      </div>
    );
  }

  const src = coverUrl.startsWith('/uploads') ? api.coverUrl(coverUrl) : coverUrl;

  return (
    <div className="group relative">
      <div
        ref={imgContainerRef}
        className={`w-full h-52 overflow-hidden ${repositioning ? 'cursor-ns-resize select-none' : ''}`}
        onMouseDown={repositioning ? handleDragStart : undefined}
      >
        <img
          src={src}
          alt="Capa"
          draggable={false}
          className="w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: `center ${posY}%` }}
        />
      </div>

      {/* Gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#191919] pointer-events-none" />

      {/* Controls */}
      <div className="absolute top-3 right-4 flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        {repositioning ? (
          <>
            <span className="px-3 py-1 text-xs bg-black/60 text-gray-300 rounded-md backdrop-blur-sm">
              Arraste para reposicionar
            </span>
            <button
              className="px-3 py-1 text-xs bg-accent text-white rounded-md backdrop-blur-sm hover:opacity-90 transition-opacity"
              onMouseDown={e => e.stopPropagation()}
              onClick={handleSavePosition}
            >
              Salvar posição
            </button>
          </>
        ) : (
          <>
            <button
              className="px-3 py-1 text-xs bg-black/50 text-white rounded-md backdrop-blur-sm hover:bg-black/70 transition-colors"
              onClick={() => setRepositioning(true)}
            >
              Reposicionar
            </button>
            <button
              className="px-3 py-1 text-xs bg-black/50 text-white rounded-md backdrop-blur-sm hover:bg-black/70 transition-colors"
              onClick={() => setShowPanel(true)}
            >
              Trocar capa
            </button>
            <button
              className="px-3 py-1 text-xs bg-black/50 text-white rounded-md backdrop-blur-sm hover:bg-black/70 transition-colors"
              onClick={handleRemove}
            >
              Remover
            </button>
          </>
        )}
      </div>

      {showPanel && (
        <CoverPanel
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          onUrlSave={handleUrlSave}
          onFileClick={() => fileRef.current?.click()}
          onRemove={handleRemove}
          onClose={() => setShowPanel(false)}
        />
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
    </div>
  );
}

export function CoverPanel({
  urlInput, setUrlInput, onUrlSave, onFileClick, onRemove, onClose,
}: {
  urlInput: string;
  setUrlInput: (v: string) => void;
  onUrlSave: () => void;
  onFileClick: () => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-full left-0 mt-2 z-50 bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl p-4 w-80">
      <p className="text-xs text-gray-500 mb-2">URL da imagem</p>
      <div className="flex gap-2 mb-3">
        <input
          autoFocus
          className="flex-1 bg-[#111] text-sm text-gray-200 rounded-lg px-3 py-1.5 outline-none border border-[#2a2a2a] focus:border-accent"
          placeholder="https://..."
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onUrlSave(); if (e.key === 'Escape') onClose(); }}
        />
        <button
          className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:opacity-90 transition-opacity"
          onClick={onUrlSave}
        >
          OK
        </button>
      </div>
      <button
        className="w-full text-xs text-gray-500 hover:text-gray-300 py-1.5 rounded-lg hover:bg-white/5 transition-colors mb-1"
        onClick={onFileClick}
      >
        📁 Enviar arquivo
      </button>
      {onRemove && (
        <button
          className="w-full text-xs text-red-500/60 hover:text-red-400 py-1 rounded-lg hover:bg-white/5 transition-colors"
          onClick={onRemove}
        >
          Remover capa
        </button>
      )}
    </div>
  );
}

// ── @ Page Picker ─────────────────────────────────────────────────────────
