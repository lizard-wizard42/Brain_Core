import { useCallback, useEffect, useState } from 'react';
import type { Editor, TLPageId, TLShape, TLShapeId } from 'tldraw';
import './designOutline.css';

interface CanvasPage { id: TLPageId; name: string }
interface CanvasLayer { id: TLShapeId; title: string; type: string; depth: number }

function shapeTitle(shape: TLShape): string {
  if (shape.type === 'frame') return String((shape.props as { name?: string }).name || 'Quadro');
  if (shape.type === 'text') return 'Texto';
  if (shape.type === 'image') return 'Imagem';
  if (shape.type === 'geo') return 'Forma';
  if (shape.type === 'arrow') return 'Seta';
  if (shape.type === 'draw') return 'Desenho';
  return shape.type.charAt(0).toUpperCase() + shape.type.slice(1);
}

function collectLayers(shapes: TLShape[], pageId: TLPageId): CanvasLayer[] {
  const children = new Map<string, TLShape[]>();
  for (const shape of shapes) {
    const parent = String(shape.parentId);
    children.set(parent, [...(children.get(parent) ?? []), shape]);
  }
  for (const list of children.values()) list.sort((a, b) => String(b.index).localeCompare(String(a.index)));
  const result: CanvasLayer[] = [];
  const visit = (parentId: string, depth: number) => {
    for (const shape of children.get(parentId) ?? []) {
      result.push({ id: shape.id, title: shapeTitle(shape), type: shape.type, depth });
      visit(shape.id, depth + 1);
    }
  };
  visit(pageId, 0);
  return result;
}

export function DesignOutline({ editor }: { editor: Editor | null }) {
  const [pages, setPages] = useState<CanvasPage[]>([]);
  const [activePageId, setActivePageId] = useState<TLPageId | null>(null);
  const [layers, setLayers] = useState<CanvasLayer[]>([]);
  const [archivedAnnotations, setArchivedAnnotations] = useState<Array<{ shapeId: string; text: string }>>([]);
  const [renamingId, setRenamingId] = useState<TLPageId | null>(null);
  const [draftName, setDraftName] = useState('');

  const refresh = useCallback(() => {
    if (!editor) { setPages([]); setLayers([]); setActivePageId(null); setArchivedAnnotations([]); return; }
    const current = editor.getCurrentPageId();
    const archive = editor.getCurrentPage().meta.brainCoreArchivedAnnotations;
    setArchivedAnnotations(Array.isArray(archive) ? archive.filter((item): item is { shapeId: string; text: string } =>
      !!item && typeof item === 'object' && !Array.isArray(item) && typeof item.shapeId === 'string' && typeof item.text === 'string') : []);
    setPages(editor.getPages().map(page => ({ id: page.id, name: page.name })));
    setActivePageId(current);
    setLayers(collectLayers(editor.getCurrentPageShapes(), current));
  }, [editor]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) refresh(); });
    const unlisten = editor?.store.listen(refresh);
    return () => { cancelled = true; unlisten?.(); };
  }, [editor, refresh]);

  const addPage = () => {
    if (!editor) return;
    const before = new Set(editor.getPages().map(page => page.id));
    editor.createPage({ name: `Página ${pages.length + 1}` });
    const created = editor.getPages().find(page => !before.has(page.id));
    if (created) editor.setCurrentPage(created.id);
    refresh();
  };

  const submitName = () => {
    const name = draftName.trim();
    if (editor && renamingId && name) editor.renamePage(renamingId, name);
    setRenamingId(null);
    refresh();
  };

  const selectLayer = (id: TLShapeId) => {
    editor?.select(id);
    editor?.zoomToSelection();
    refresh();
  };

  return <aside className="design-outline" aria-label="Páginas e camadas de Design">
    <div className="design-outline-brand"><span aria-hidden="true">▣</span><strong>Design</strong></div>
    <div className="design-outline-section-heading"><span>Páginas</span><button type="button" title="Adicionar página" aria-label="Adicionar página de Design" onClick={addPage} disabled={!editor}>+</button></div>
    <div className="design-outline-pages">
      {pages.map(page => <div key={page.id} className={`design-outline-page ${page.id === activePageId ? 'is-active' : ''}`}>
        {renamingId === page.id ? <input aria-label="Nome da página de Design" autoFocus value={draftName} onChange={event => setDraftName(event.target.value)} onBlur={submitName} onKeyDown={event => { if (event.key === 'Enter') submitName(); if (event.key === 'Escape') setRenamingId(null); }} /> : <>
          <button type="button" className="design-outline-page-open" aria-current={page.id === activePageId ? 'page' : undefined} onClick={() => { editor?.setCurrentPage(page.id); refresh(); }}><span aria-hidden="true">▤</span><span>{page.name}</span></button>
          <button type="button" className="design-outline-rename" aria-label={`Renomear ${page.name}`} title="Renomear página" onClick={() => { setDraftName(page.name); setRenamingId(page.id); }}>✎</button>
        </>}
      </div>)}
    </div>
    <div className="design-outline-section-heading"><span>Camadas</span><span className="design-outline-count">{layers.length}</span></div>
    <div className="design-outline-layers">
      {layers.length === 0 && <p className="design-outline-empty">Crie um quadro ou desenhe no canvas para começar.</p>}
      {layers.map(layer => <button type="button" key={layer.id} className="design-outline-layer" style={{ paddingLeft: `${12 + Math.min(layer.depth, 5) * 16}px` }} onClick={() => selectLayer(layer.id)} title={`${layer.title} · ${layer.type}`} aria-label={`Camada: ${layer.title}`}><span aria-hidden="true">{layer.type === 'frame' ? '▣' : layer.type === 'image' ? '▧' : layer.type === 'text' ? 'Aa' : '◇'}</span><span>{layer.title}</span></button>)}
    </div>
    {archivedAnnotations.length > 0 && <details className="design-outline-archive">
      <summary>Anotações preservadas ({archivedAnnotations.length})</summary>
      {archivedAnnotations.map(item => <p key={item.shapeId}>{item.text}</p>)}
    </details>}
    <div className="design-outline-tools" role="group" aria-label="Ferramentas do canvas">
      {[{ label: 'Selecionar', tool: 'select', icon: '↖' }, { label: 'Mover canvas', tool: 'hand', icon: '✋' }, { label: 'Quadro', tool: 'frame', icon: '▣' }, { label: 'Forma', tool: 'geo', icon: '□' }, { label: 'Texto', tool: 'text', icon: 'Aa' }, { label: 'Desenhar', tool: 'draw', icon: '✎' }].map(item => <button type="button" key={item.tool} title={item.label} aria-label={item.label} disabled={!editor} onClick={() => editor?.setCurrentTool(item.tool)}>{item.icon}</button>)}
    </div>
  </aside>;
}
