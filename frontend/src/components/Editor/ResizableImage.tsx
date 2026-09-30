import { useCallback } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import { resolveAssetUrl } from '../../api/assetUrl';

const IMAGE_MIN_WIDTH_PERCENT = 20;
const IMAGE_MAX_WIDTH_PERCENT = 100;
function clampImageWidthPercent(value: number): number {
  return Math.min(IMAGE_MAX_WIDTH_PERCENT, Math.max(IMAGE_MIN_WIDTH_PERCENT, value));
}

function parseImageWidthPercent(width: unknown): number | null {
  if (typeof width !== 'string') return null;
  const match = width.trim().match(/^(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return clampImageWidthPercent(parsed);
}

export function ResizableImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const widthPercent = parseImageWidthPercent(node.attrs.width) ?? IMAGE_MAX_WIDTH_PERCENT;

  const startResize = useCallback((event: React.MouseEvent, direction: -1 | 1) => {
    event.preventDefault();
    event.stopPropagation();

    const editorElement = editor.options.element as HTMLElement | null;
    const containerWidth = editorElement?.clientWidth ?? 0;
    if (!containerWidth) return;

    const startX = event.clientX;
    const startWidth = widthPercent;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaPx = (moveEvent.clientX - startX) * direction;
      const deltaPercent = (deltaPx / containerWidth) * 100;
      const next = clampImageWidthPercent(startWidth + deltaPercent);
      updateAttributes({ width: `${Math.round(next)}%` });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [editor.options.element, updateAttributes, widthPercent]);

  return (
    <NodeViewWrapper
      className="relative block max-w-full my-3"
      style={{ width: `${Math.round(widthPercent)}%` }}
      contentEditable={false}
      data-image-node-view="true"
    >
      <img
        src={resolveAssetUrl(node.attrs.src)}
        alt={node.attrs.alt || ''}
        title={node.attrs.title || ''}
        className="w-full h-auto rounded-lg block"
        draggable={false}
      />
      {selected && (
        <>
          <button
            type="button"
            className="absolute left-[-7px] top-1/2 -translate-y-1/2 h-12 w-3 rounded-full bg-accent/90 border border-white/70 shadow-md cursor-ew-resize"
            onMouseDown={(event) => startResize(event, -1)}
            aria-label="Redimensionar imagem pela esquerda"
          />
          <button
            type="button"
            className="absolute right-[-7px] top-1/2 -translate-y-1/2 h-12 w-3 rounded-full bg-accent/90 border border-white/70 shadow-md cursor-ew-resize"
            onMouseDown={(event) => startResize(event, 1)}
            aria-label="Redimensionar imagem pela direita"
          />
        </>
      )}
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const dataWidth = element.getAttribute('data-width');
          if (dataWidth) return dataWidth;

          const styleWidth = (element as HTMLElement).style?.width;
          if (styleWidth) return styleWidth;

          const widthAttr = element.getAttribute('width');
          if (widthAttr && /^\d+(\.\d+)?$/.test(widthAttr)) return `${widthAttr}px`;
          return null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return {
            'data-width': attributes.width,
            style: `width: ${attributes.width};`,
          };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

// ── New Table Modal ────────────────────────────────────────────────────────
