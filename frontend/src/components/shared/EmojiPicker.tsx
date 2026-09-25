import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import data from '@emoji-mart/data';
import { Picker } from 'emoji-mart';
import { api } from '../../api/client';
import type { CustomEmoji } from '../../types';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Viewport-space rect of the trigger element (from getBoundingClientRect). */
  anchorRect: DOMRect;
}

type EmojiMartSelect = {
  native?: string;
  skins?: Array<{ src?: string }>;
};

export function EmojiPicker({ onSelect, onClose, anchorRect }: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerMountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const PICKER_W = 340;
  const PICKER_MAX_H = 460;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchorRect.left;
  if (left + PICKER_W > vw - 8) left = vw - PICKER_W - 8;
  if (left < 8) left = 8;

  let top = anchorRect.bottom + 4;
  if (top + PICKER_MAX_H > vh - 8) top = anchorRect.top - PICKER_MAX_H - 4;
  if (top < 8) top = 8;

  useEffect(() => {
    let cancelled = false;
    api.listCustomEmojis()
      .then(items => {
        if (!cancelled) setCustomEmojis(items);
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar emojis customizados');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const custom = useMemo(
    () =>
      customEmojis.map(item => ({
        id: item.id,
        name: item.name,
        keywords: [item.name],
        skins: [{ src: item.url }],
      })),
    [customEmojis]
  );

  useEffect(() => {
    if (!pickerMountRef.current) return;

    pickerMountRef.current.innerHTML = '';
    const picker = new Picker({
      data,
      custom,
      theme: 'dark',
      locale: 'pt',
      set: 'native',
      perLine: 9,
      previewPosition: 'none',
      skinTonePosition: 'search',
      onEmojiSelect: (emoji: EmojiMartSelect) => {
        const value =
          typeof emoji.native === 'string' && emoji.native
            ? emoji.native
            : (emoji.skins?.[0]?.src ?? '');
        if (value) {
          onSelect(value);
          onClose();
        }
      },
    });

    const mountNode = pickerMountRef.current;
    mountNode.appendChild(picker as unknown as Node);

    return () => {
      mountNode.innerHTML = '';
    };
  }, [custom, onClose, onSelect]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (file.type !== 'image/png') {
      setError('Somente PNG é permitido para emoji customizado');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const created = await api.uploadCustomEmoji(file);
      setCustomEmojis(prev => [created, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload do emoji');
    } finally {
      setUploading(false);
    }
  }

  return createPortal(
    <div
      ref={pickerRef}
      style={{ position: 'fixed', top, left, zIndex: 99999 }}
      className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl shadow-2xl p-2 w-[340px]"
    >
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-[11px] uppercase tracking-widest text-gray-600">Emojis</span>
        <button
          className="px-2 py-1 text-[11px] rounded bg-white/5 text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
          disabled={uploading}
          onMouseDown={e => {
            e.preventDefault();
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          title="Adicionar emoji PNG customizado"
        >
          {uploading ? 'Enviando...' : '+ PNG'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
      <div ref={pickerMountRef} />
      {error && (
        <div className="px-2 pt-2 text-[11px] text-red-400">{error}</div>
      )}
      <button
        className="mt-2 w-full text-xs text-gray-500 hover:text-gray-300 py-1 rounded hover:bg-white/5 transition-colors"
        onMouseDown={e => {
          e.preventDefault();
          e.stopPropagation();
          onSelect('');
          onClose();
        }}
      >
        Remover ícone
      </button>
    </div>,
    document.body,
  );
}
