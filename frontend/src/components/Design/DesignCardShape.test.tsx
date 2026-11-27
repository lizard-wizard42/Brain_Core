import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { DesignCardShape } from './DesignCardShape';
import { DesignCardShapeUtil } from './DesignCardShape';
import { cardAppearance } from './designCardModel';

vi.mock('tldraw', () => ({
  HTMLContainer: 'div', Rectangle2d: class {}, ShapeUtil: class {},
  T: { number: {}, string: {} }, resizeBox: vi.fn(),
}));

const util = Object.create(DesignCardShapeUtil.prototype) as DesignCardShapeUtil;
const shape = (): DesignCardShape => ({
  id: 'shape:synthetic-card', typeName: 'shape', type: 'design-card', parentId: 'page:one', index: 'a1',
  x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false, meta: {}, props: util.getDefaultProps(),
}) as DesignCardShape;

it('renders the same card properties in the canvas and SVG export', () => {
  const card = shape();
  card.props.text = 'Post de exemplo'; card.props.fill = '#123456'; card.props.radius = 24;
  card.props.borderWidth = 3; card.props.shadowBlur = 14;
  card.props.blendMode = 'multiply'; card.props.brightness = 110;
  const canvas = util.component(card);
  const surface = canvas.props.children as React.ReactElement<{ style: React.CSSProperties }>;
  expect(surface.props.style.backgroundColor).toBe('#123456');
  expect(surface.props.style.borderRadius).toBe(24);
  expect(surface.props.style.filter).toContain('brightness(110%)');
  const svg = renderToStaticMarkup(util.toSvg(card));
  expect(svg).toContain('fill="#123456"');
  expect(svg).toContain('rx="24"');
  expect(svg).toContain('stroke-width="3"');
  expect(svg).toContain('feDropShadow');
  expect(svg).toContain('feComponentTransfer');
  expect(svg).toContain('mix-blend-mode:multiply');
  expect(svg).toContain('Post de exemplo');
});

it('clamps invalid styling before rendering and exporting', () => {
  const style = cardAppearance({ ...util.getDefaultProps(), fill: 'url(javascript:bad)', radius: -12,
    borderWidth: 1000, blendMode: 'unsupported' as never, brightness: Number.POSITIVE_INFINITY });
  expect(style.fill).toBe('#ffffff');
  expect(style.radius).toBe(0);
  expect(style.borderWidth).toBe(40);
  expect(style.blendMode).toBe('normal');
  expect(style.brightness).toBe(0);
});

it('keeps explicit line breaks and clips long text in the exported preview', () => {
  const card = shape();
  card.props.text = 'Primeira linha\nSegunda linha muito longa que ultrapassa o cartão';
  const canvas = util.component(card);
  const surface = canvas.props.children as React.ReactElement<{ style: React.CSSProperties }>;
  expect(surface.props.style.whiteSpace).toBeUndefined(); // class supplies preformatted, clipped text
  const svg = renderToStaticMarkup(util.toSvg(card));
  expect(svg).toContain('<clipPath');
  expect(svg).toContain('clip-path="url(#design-card-shape-synthetic-card-clip)"');
  expect(svg).toContain('<tspan x="16" dy="0">Primeira linha</tspan>');
  expect(svg).toContain('Segunda linha muito');
  expect(svg).toContain('longa que ultrapassa');
});
