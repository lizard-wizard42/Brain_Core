export const DESIGN_CARD_TYPE = 'design-card' as const;
export type DesignBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export interface DesignCardProps {
  w: number; h: number; text: string; textColor: string; fontSize: number;
  fill: string; radius: number; borderWidth: number; borderColor: string;
  shadowX: number; shadowY: number; shadowBlur: number; shadowColor: string;
  blendMode: DesignBlendMode; brightness: number; contrast: number; saturation: number;
  fontFamily?: string; fontWeight?: number; textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom'; padding?: number;
  lineHeight?: number; letterSpacing?: number; gradientTo?: string;
}

export const cardDefaults: DesignCardProps = {
  w: 320, h: 240, text: '', textColor: '#111827', fontSize: 24,
  fill: '#ffffff', radius: 16, borderWidth: 1, borderColor: '#d9dde5',
  shadowX: 0, shadowY: 8, shadowBlur: 20, shadowColor: '#00000033',
  blendMode: 'normal', brightness: 100, contrast: 100, saturation: 100,
  fontFamily: 'Inter', fontWeight: 400, textAlign: 'left', verticalAlign: 'top',
  padding: 16, lineHeight: 1.2, letterSpacing: 0,
};

const safeHex = (value: string, fallback: string) => /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value) ? value : fallback;
const safeNumber = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
const safeBlend = (value: string): DesignBlendMode => ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'].includes(value) ? value as DesignBlendMode : 'normal';

export function cardAppearance(props: DesignCardProps) {
  return {
    fill: safeHex(props.fill, cardDefaults.fill), radius: safeNumber(props.radius, 0, 500),
    borderWidth: safeNumber(props.borderWidth, 0, 40), borderColor: safeHex(props.borderColor, cardDefaults.borderColor),
    shadowX: safeNumber(props.shadowX, -200, 200), shadowY: safeNumber(props.shadowY, -200, 200),
    shadowBlur: safeNumber(props.shadowBlur, 0, 200), shadowColor: safeHex(props.shadowColor, cardDefaults.shadowColor),
    textColor: safeHex(props.textColor, cardDefaults.textColor), fontSize: safeNumber(props.fontSize, 8, 160),
    blendMode: safeBlend(props.blendMode), brightness: safeNumber(props.brightness, 0, 200),
    contrast: safeNumber(props.contrast, 0, 200), saturation: safeNumber(props.saturation, 0, 200),
    fontFamily: ['Inter', 'Arial', 'Georgia', 'monospace'].includes(props.fontFamily ?? '') ? props.fontFamily! : 'Inter',
    fontWeight: safeNumber(props.fontWeight ?? 400, 100, 900),
    textAlign: ['left', 'center', 'right'].includes(props.textAlign ?? '') ? props.textAlign! : 'left',
    verticalAlign: ['top', 'middle', 'bottom'].includes(props.verticalAlign ?? '') ? props.verticalAlign! : 'top',
    padding: safeNumber(props.padding ?? 16, 0, 200), lineHeight: safeNumber(props.lineHeight ?? 1.2, 0.8, 3),
    letterSpacing: safeNumber(props.letterSpacing ?? 0, -5, 20),
    gradientTo: props.gradientTo ? safeHex(props.gradientTo, cardDefaults.fill) : undefined,
  };
}
