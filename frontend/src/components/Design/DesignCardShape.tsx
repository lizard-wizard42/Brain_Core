import { HTMLContainer, Rectangle2d, ShapeUtil, T, resizeBox } from 'tldraw';
import type { RecordProps, TLResizeInfo, TLShape } from 'tldraw';
import { DESIGN_CARD_TYPE, cardAppearance, cardDefaults } from './designCardModel';
import type { DesignCardProps } from './designCardModel';
import './designCardShape.css';

declare module 'tldraw' {
  interface TLGlobalShapePropsMap { [DESIGN_CARD_TYPE]: DesignCardProps }
}

export type DesignCardShape = TLShape<typeof DESIGN_CARD_TYPE>;

function wrapCardText(value: string, width: number, fontSize: number, padding = 16, letterSpacing = 0): string[] {
  const maxChars = Math.max(1, Math.floor(Math.max(1, width - padding * 2) / Math.max(1, fontSize * 0.55 + letterSpacing)));
  return value.split(/\r?\n/).flatMap(paragraph => {
    const lines: string[] = [];
    let remaining = paragraph;
    while (remaining.length > maxChars) {
      const breakAt = remaining.lastIndexOf(' ', maxChars);
      const count = breakAt > 0 ? breakAt : maxChars;
      lines.push(remaining.slice(0, count));
      remaining = remaining.slice(count).trimStart();
    }
    lines.push(remaining);
    return lines;
  });
}

export class DesignCardShapeUtil extends ShapeUtil<DesignCardShape> {
  static override type = DESIGN_CARD_TYPE;
  static override props: RecordProps<DesignCardShape> = {
    w: T.number, h: T.number, text: T.string, textColor: T.string, fontSize: T.number,
    fill: T.string, radius: T.number, borderWidth: T.number, borderColor: T.string,
    shadowX: T.number, shadowY: T.number, shadowBlur: T.number, shadowColor: T.string,
    blendMode: T.string as RecordProps<DesignCardShape>['blendMode'],
    brightness: T.number, contrast: T.number, saturation: T.number,
    fontFamily: T.optional(T.string), fontWeight: T.optional(T.number),
    textAlign: T.optional(T.string) as RecordProps<DesignCardShape>['textAlign'],
    verticalAlign: T.optional(T.string) as RecordProps<DesignCardShape>['verticalAlign'],
    padding: T.optional(T.number), lineHeight: T.optional(T.number),
    letterSpacing: T.optional(T.number), gradientTo: T.optional(T.string),
  };

  getDefaultProps(): DesignCardProps { return { ...cardDefaults }; }
  override canResize() { return true; }
  override isAspectRatioLocked() { return false; }
  getGeometry(shape: DesignCardShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  override onResize(shape: DesignCardShape, info: TLResizeInfo<DesignCardShape>) { return resizeBox(shape, info); }
  getIndicatorPath(shape: DesignCardShape) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path; }

  component(shape: DesignCardShape) {
    const p = cardAppearance(shape.props);
    return <HTMLContainer className="design-card-container" style={{ width: shape.props.w, height: shape.props.h, mixBlendMode: p.blendMode }}>
      <div className="design-card-surface" style={{
        width: '100%', height: '100%', backgroundColor: p.fill, backgroundImage: p.gradientTo ? `linear-gradient(180deg, ${p.fill}, ${p.gradientTo})` : undefined, borderRadius: p.radius,
        border: `${p.borderWidth}px solid ${p.borderColor}`,
        boxShadow: `${p.shadowX}px ${p.shadowY}px ${p.shadowBlur}px ${p.shadowColor}`,
        filter: `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturation}%)`,
        color: p.textColor, fontSize: p.fontSize, fontFamily: p.fontFamily,
        fontWeight: p.fontWeight, textAlign: p.textAlign, padding: p.padding,
        lineHeight: p.lineHeight, letterSpacing: p.letterSpacing,
        display: 'flex', flexDirection: 'column', justifyContent: p.verticalAlign === 'top' ? 'flex-start' : p.verticalAlign === 'middle' ? 'center' : 'flex-end',
      }}>{shape.props.text}</div>
    </HTMLContainer>;
  }

  override toSvg(shape: DesignCardShape) {
    const p = cardAppearance(shape.props);
    const filterId = `design-card-${shape.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const clipId = `${filterId}-clip`;
    const contrast = p.contrast / 100, brightness = p.brightness / 100;
    const intercept = (1 - contrast) / 2;
    const shadow = p.shadowBlur > 0 || p.shadowX !== 0 || p.shadowY !== 0;
    const shadowColor = p.shadowColor.slice(0, 7);
    const shadowOpacity = p.shadowColor.length === 9 ? parseInt(p.shadowColor.slice(7), 16) / 255 : 1;
    const textLines = wrapCardText(shape.props.text, shape.props.w - p.borderWidth * 2, p.fontSize, p.padding, p.letterSpacing);
    const textX = p.textAlign === 'center' ? shape.props.w / 2 : p.textAlign === 'right' ? shape.props.w - p.padding : p.padding;
    const lineStep = p.fontSize * p.lineHeight;
    const textY = p.verticalAlign === 'middle' ? (shape.props.h - textLines.length * lineStep) / 2 + p.fontSize
      : p.verticalAlign === 'bottom' ? shape.props.h - p.padding - (textLines.length - 1) * lineStep : p.padding + p.fontSize;
    const gradientId = `${filterId}-gradient`;
    return <g style={{ mixBlendMode: p.blendMode }}>
      <defs>{p.gradientTo && <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={p.fill} /><stop offset="100%" stopColor={p.gradientTo} /></linearGradient>}<clipPath id={clipId}><rect width={shape.props.w} height={shape.props.h} rx={p.radius} ry={p.radius} /></clipPath><filter id={filterId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
        <feComponentTransfer in="SourceGraphic" result="bright"><feFuncR type="linear" slope={brightness} /><feFuncG type="linear" slope={brightness} /><feFuncB type="linear" slope={brightness} /></feComponentTransfer>
        <feComponentTransfer in="bright" result="contrasted"><feFuncR type="linear" slope={contrast} intercept={intercept} /><feFuncG type="linear" slope={contrast} intercept={intercept} /><feFuncB type="linear" slope={contrast} intercept={intercept} /></feComponentTransfer>
        <feColorMatrix in="contrasted" type="saturate" values={String(p.saturation / 100)} result="toned" />
        {shadow && <feDropShadow in="toned" dx={p.shadowX} dy={p.shadowY} stdDeviation={p.shadowBlur / 2} floodColor={shadowColor} floodOpacity={shadowOpacity} />}
      </filter></defs>
      <g filter={`url(#${filterId})`}>
        <rect x={p.borderWidth / 2} y={p.borderWidth / 2} width={Math.max(0, shape.props.w - p.borderWidth)} height={Math.max(0, shape.props.h - p.borderWidth)} rx={Math.max(0, p.radius - p.borderWidth / 2)} ry={Math.max(0, p.radius - p.borderWidth / 2)} fill={p.gradientTo ? `url(#${gradientId})` : p.fill} stroke={p.borderColor} strokeWidth={p.borderWidth} />
        {shape.props.text && <text x={textX} y={textY} textAnchor={p.textAlign === 'left' ? 'start' : p.textAlign === 'center' ? 'middle' : 'end'} fill={p.textColor} fontSize={p.fontSize} fontFamily={p.fontFamily} fontWeight={p.fontWeight} letterSpacing={p.letterSpacing} clipPath={`url(#${clipId})`}>{textLines.map((line, index) => <tspan key={index} x={textX} dy={index ? lineStep : 0}>{line}</tspan>)}</text>}
      </g>
    </g>;
  }
}
