import { useState } from 'react';
import type { Editor, TLShape, TLShapeId } from 'tldraw';
import { DESIGN_CARD_TYPE, cardAppearance } from './designCardModel';
import type { DesignCardProps, DesignBlendMode } from './designCardModel';
import './designInspector.css';

interface DesignInspectorProps {
  editor: Editor | null;
  selectedShapeId: TLShapeId | null;
  onPreview: () => void;
  onExport: () => void;
}

const colors = ['black', 'grey', 'white', 'red', 'orange', 'yellow', 'green', 'blue', 'violet'] as const;
const fills = [
  ['none', 'Nenhum'], ['semi', 'Leve'], ['solid', 'Sólido'], ['pattern', 'Padrão'],
] as const;
const dashes = [['solid', 'Sólida'], ['dashed', 'Tracejada'], ['dotted', 'Pontilhada'], ['draw', 'Desenhada']] as const;
const sizes = [['s', 'Fina'], ['m', 'Média'], ['l', 'Grossa'], ['xl', 'Extra']] as const;
const geometry = [['rectangle', 'Retângulo'], ['ellipse', 'Elipse'], ['triangle', 'Triângulo'], ['diamond', 'Losango'], ['star', 'Estrela'], ['cloud', 'Nuvem']] as const;
const number = (value: number) => Math.round(value * 100) / 100;
const positive = (value: number) => Number.isFinite(value) && value >= 1 && value <= 10000;

function NumberField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  return <label className="design-inspector-number"><span>{label}</span><input type="number" aria-label={label} value={number(value)} min={min} max={max} step={step}
    onChange={event => { const next = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max)) onChange(next); }} /></label>;
}

function HexField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="design-inspector-hex"><span>{label}</span><input type="text" aria-label={label} key={`${label}:${value}`} defaultValue={value} maxLength={9} onBlur={event => {
    const next = event.target.value.trim();
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(next)) onChange(next);
    else event.target.value = value;
  }} /></label>;
}

/** Only exposes properties supported by the selected tldraw shape. */
export function DesignInspector({ editor, selectedShapeId, onPreview, onExport }: DesignInspectorProps) {
  const shape = editor && selectedShapeId ? editor.getShape(selectedShapeId) : undefined;
  const [gap, setGap] = useState(24);
  const [direction, setDirection] = useState<'row' | 'column'>('row');
  const [guideState, setGuideState] = useState<{ editor: Editor; snap: boolean; grid: boolean } | null>(null);
  const snap = guideState?.editor === editor ? guideState.snap : editor?.user.getUserPreferences().isSnapMode ?? false;
  const grid = guideState?.editor === editor ? guideState.grid : editor?.getInstanceState().isGridMode ?? false;
  const props = shape?.props as Record<string, unknown> | undefined;
  const hasWidth = typeof props?.w === 'number';
  const hasHeight = typeof props?.h === 'number';
  const hasColor = typeof props?.color === 'string';
  const isDesignCard = shape?.type === DESIGN_CARD_TYPE;
  const hasFill = !isDesignCard && typeof props?.fill === 'string';
  const hasDash = typeof props?.dash === 'string';
  const hasSize = typeof props?.size === 'string';
  const card = isDesignCard ? cardAppearance(shape.props as DesignCardProps) : null;
  const selectedIds = editor?.getSelectedShapeIds() ?? [];
  const palette = editor?.getCurrentPageShapes().reduce((map, item) => {
    const color = (item.props as Record<string, unknown>).color;
    if (typeof color === 'string' && colors.some(candidate => candidate === color)) map.set(color, (map.get(color) ?? 0) + 1);
    return map;
  }, new Map<string, number>()) ?? new Map<string, number>();

  const update = (patch: Partial<TLShape>) => { if (editor && shape) editor.updateShape({ ...shape, ...patch } as TLShape); };
  const updateProps = (patch: Record<string, unknown>) => { if (editor && shape) editor.updateShape({ ...shape, props: { ...shape.props, ...patch } } as TLShape); };
  const arrange = () => {
    if (!editor || shape?.type !== 'frame') return;
    const children = editor.getCurrentPageShapes().filter(child => child.parentId === shape.id);
    let position = 0;
    editor.updateShapes(children.map(child => {
      const bounds = editor.getShapeGeometry(child).bounds;
      const next = { ...child, x: direction === 'row' ? position : gap, y: direction === 'column' ? position : gap } as TLShape;
      position += (direction === 'row' ? bounds.w : bounds.h) + gap;
      return next;
    }));
  };

  return <aside className="design-inspector" aria-label="Propriedades de Design">
    <div className="design-inspector-heading"><strong>Design</strong><span>{shape ? shape.type === 'frame' ? 'Quadro selecionado' : 'Elemento selecionado' : 'Selecione um elemento'}</span></div>
    {!shape && <p className="design-inspector-empty">Selecione um quadro ou elemento para editar suas propriedades.</p>}
    {shape && <>
      <section className="design-inspector-section" aria-label="Layout"><h3>Layout</h3><div className="design-inspector-grid">
        <NumberField label="X" value={shape.x} onChange={x => update({ x })} />
        <NumberField label="Y" value={shape.y} onChange={y => update({ y })} />
        <NumberField label="Rotação" value={shape.rotation * 180 / Math.PI} min={-360} max={360} onChange={degrees => update({ rotation: degrees * Math.PI / 180 })} />
        {hasWidth && <NumberField label="Largura" value={props?.w as number} min={1} max={10000} onChange={w => { if (positive(w)) updateProps({ w }); }} />}
        {hasHeight && <NumberField label="Altura" value={props?.h as number} min={1} max={10000} onChange={h => { if (positive(h)) updateProps({ h }); }} />}
      </div></section>
      {shape.type === 'frame' && <section className="design-inspector-section" aria-label="Organizar conteúdo"><h3>Organizar conteúdo</h3><p className="design-inspector-hint">Distribui os elementos já colocados dentro do quadro.</p><div className="design-inspector-row">
        <select aria-label="Direção" value={direction} onChange={event => setDirection(event.target.value as 'row' | 'column')}><option value="row">Horizontal</option><option value="column">Vertical</option></select>
        <NumberField label="Espaço" value={gap} min={0} max={500} onChange={setGap} />
      </div><button type="button" onClick={arrange}>Organizar elementos</button></section>}
      {selectedIds.length > 1 && <section className="design-inspector-section" aria-label="Alinhamento"><h3>Alinhar seleção</h3><div className="design-inspector-action-grid">
        <button type="button" onClick={() => editor?.alignShapes(selectedIds, 'left')}>Esquerda</button>
        <button type="button" onClick={() => editor?.alignShapes(selectedIds, 'center-horizontal')}>Centro H</button>
        <button type="button" onClick={() => editor?.alignShapes(selectedIds, 'right')}>Direita</button>
        <button type="button" onClick={() => editor?.alignShapes(selectedIds, 'top')}>Topo</button>
        <button type="button" onClick={() => editor?.alignShapes(selectedIds, 'center-vertical')}>Centro V</button>
        <button type="button" onClick={() => editor?.alignShapes(selectedIds, 'bottom')}>Base</button>
        {selectedIds.length > 2 && <><button type="button" onClick={() => editor?.distributeShapes(selectedIds, 'horizontal')}>Distribuir H</button><button type="button" onClick={() => editor?.distributeShapes(selectedIds, 'vertical')}>Distribuir V</button></>}
      </div></section>}
      {shape.type === 'geo' && <section className="design-inspector-section" aria-label="Geometria"><h3>Geometria</h3><select aria-label="Formato da forma" value={String(props?.geo)} onChange={event => updateProps({ geo: event.target.value })}>{geometry.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></section>}
      {card && <>
        <section className="design-inspector-section" aria-label="Conteúdo do cartão"><h3>Conteúdo</h3><label className="design-inspector-text"><span>Texto</span><textarea aria-label="Texto do cartão" value={String(props?.text ?? '')} onChange={event => updateProps({ text: event.target.value })} rows={3} maxLength={5000} /></label><NumberField label="Fonte px" value={card.fontSize} min={8} max={160} onChange={fontSize => updateProps({ fontSize })} /><HexField label="Cor do texto" value={card.textColor} onChange={textColor => updateProps({ textColor })} /></section>
        <section className="design-inspector-section" aria-label="Preenchimento do cartão"><h3>Preenchimento</h3><HexField label="Cor de fundo" value={card.fill} onChange={fill => updateProps({ fill })} /><NumberField label="Raio px" value={card.radius} min={0} max={500} onChange={radius => updateProps({ radius })} /></section>
        <section className="design-inspector-section" aria-label="Borda do cartão"><h3>Borda</h3><div className="design-inspector-grid"><NumberField label="Largura px" value={card.borderWidth} min={0} max={40} onChange={borderWidth => updateProps({ borderWidth })} /></div><HexField label="Cor da borda" value={card.borderColor} onChange={borderColor => updateProps({ borderColor })} /></section>
        <section className="design-inspector-section" aria-label="Sombra do cartão"><h3>Sombra</h3><div className="design-inspector-grid"><NumberField label="Sombra X" value={card.shadowX} min={-200} max={200} onChange={shadowX => updateProps({ shadowX })} /><NumberField label="Sombra Y" value={card.shadowY} min={-200} max={200} onChange={shadowY => updateProps({ shadowY })} /><NumberField label="Desfoque px" value={card.shadowBlur} min={0} max={200} onChange={shadowBlur => updateProps({ shadowBlur })} /></div><HexField label="Cor da sombra" value={card.shadowColor} onChange={shadowColor => updateProps({ shadowColor })} /></section>
        <section className="design-inspector-section" aria-label="Mistura do cartão"><h3>Mistura</h3><select aria-label="Modo de mistura" value={card.blendMode} onChange={event => updateProps({ blendMode: event.target.value as DesignBlendMode })}>{[['normal','Normal'],['multiply','Multiplicar'],['screen','Tela'],['overlay','Sobrepor'],['darken','Escurecer'],['lighten','Clarear']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></section>
        <section className="design-inspector-section" aria-label="Filtros do cartão"><h3>Filtros</h3><div className="design-inspector-grid"><NumberField label="Brilho %" value={card.brightness} min={0} max={200} onChange={brightness => updateProps({ brightness })} /><NumberField label="Contraste %" value={card.contrast} min={0} max={200} onChange={contrast => updateProps({ contrast })} /><NumberField label="Saturação %" value={card.saturation} min={0} max={200} onChange={saturation => updateProps({ saturation })} /></div></section>
      </>}
      <section className="design-inspector-section" aria-label="Transparência"><h3>Transparência</h3><label className="design-inspector-range"><input type="range" aria-label="Opacidade" min={0} max={100} value={Math.round(shape.opacity * 100)} onChange={event => update({ opacity: Number(event.target.value) / 100 as TLShape['opacity'] })} /><span>{Math.round(shape.opacity * 100)}%</span></label></section>
      {hasColor && <section className="design-inspector-section" aria-label="Cor"><h3>Cor</h3><div className="design-inspector-swatches">{colors.map(color => <button key={color} type="button" aria-label={`Cor ${color}`} aria-pressed={props?.color === color} data-color={color} onClick={() => updateProps({ color })} />)}</div></section>}
      {hasFill && <section className="design-inspector-section" aria-label="Preenchimento"><h3>Preenchimento</h3><select aria-label="Preenchimento" value={props?.fill as string} onChange={event => updateProps({ fill: event.target.value })}>{fills.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></section>}
      {(hasDash || hasSize) && <section className="design-inspector-section" aria-label="Borda"><h3>Borda</h3><div className="design-inspector-row">{hasDash && <select aria-label="Estilo da borda" value={props?.dash as string} onChange={event => updateProps({ dash: event.target.value })}>{dashes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}{hasSize && <select aria-label="Espessura da borda" value={props?.size as string} onChange={event => updateProps({ size: event.target.value })}>{sizes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</div></section>}
      <section className="design-inspector-section" aria-label="Proteção"><h3>Proteção</h3><label className="design-inspector-toggle"><input type="checkbox" checked={shape.isLocked} onChange={event => update({ isLocked: event.target.checked })} /> Bloquear elemento</label></section>
    </>}
    {palette.size > 0 && <section className="design-inspector-section" aria-label="Cores usadas"><h3>Cores usadas</h3><p className="design-inspector-hint">Selecione elementos e clique em uma cor para aplicá-la.</p><div className="design-inspector-palette">{[...palette].map(([color, count]) => <button key={color} type="button" disabled={!selectedIds.length} aria-label={`Aplicar cor ${color} a ${selectedIds.length} elementos`} onClick={() => { if (!editor) return; editor.updateShapes(selectedIds.flatMap(id => { const target = editor.getShape(id); return target && typeof (target.props as Record<string, unknown>).color === 'string' ? [{ ...target, props: { ...target.props, color } } as TLShape] : []; })); }}><span data-color={color} /><span>{color}</span><strong>{count}</strong></button>)}</div></section>}
    {editor && <section className="design-inspector-section" aria-label="Guias"><h3>Guias</h3><label className="design-inspector-toggle"><input type="checkbox" checked={snap} onChange={event => { const value = event.target.checked; editor.user.updateUserPreferences({ isSnapMode: value }); setGuideState({ editor, snap: value, grid }); }} /> Encaixar elementos</label><label className="design-inspector-toggle"><input type="checkbox" checked={grid} onChange={event => { const value = event.target.checked; editor.updateInstanceState({ isGridMode: value }); setGuideState({ editor, snap, grid: value }); }} /> Mostrar grade</label></section>}
    <section className="design-inspector-section design-inspector-export" aria-label="Exportar"><h3>Exportar</h3><div className="design-inspector-row"><button type="button" onClick={onPreview}>Prévia</button><button type="button" onClick={onExport}>PNG</button></div></section>
  </aside>;
}
