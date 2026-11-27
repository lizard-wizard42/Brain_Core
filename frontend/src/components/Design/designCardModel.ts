export const DESIGN_CARD_TYPE = 'design-card' as const;
export type DesignBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export interface DesignCardProps {
  w: number; h: number; text: string; textColor: string; fontSize: number;
  fill: string; radius: number; borderWidth: number; borderColor: string;
  shadowX: number; shadowY: number; shadowBlur: number; shadowColor: string;
  blendMode: DesignBlendMode; brightness: number; contrast: number; saturation: number;
}

export const cardDefaults: DesignCardProps = {
  w: 320, h: 240, text: '', textColor: '#111827', fontSize: 24,
  fill: '#ffffff', radius: 16, borderWidth: 1, borderColor: '#d9dde5',
  shadowX: 0, shadowY: 8, shadowBlur: 20, shadowColor: '#00000033',
  blendMode: 'normal', brightness: 100, contrast: 100, saturation: 100,
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
  };
}
