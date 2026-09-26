export const themes = {
  dark: { label: 'Escuro', context: 'Visual padrão', background: '#0F0E0D', primary: '#3B82F6', accent: '#60A5FA', text: '#F3F4F6', light: false },
  light: { label: 'Claro', context: 'Leitura em ambiente iluminado', background: '#F8FAFC', primary: '#3B82F6', accent: '#6366F1', text: '#1E293B', light: true },
  'deep-sea': { label: 'Deep Sea', context: 'Refrigeração e trabalho técnico', background: '#0A192F', primary: '#00D2FF', accent: '#3A7BD5', text: '#E6F1FF', light: false },
  'cyber-sunset': { label: 'Cyber Sunset', context: 'Criatividade e projetos', background: '#1A0B2E', primary: '#FF0080', accent: '#7928CA', text: '#FFFFFF', light: false },
  'minty-fresh': { label: 'Minty Fresh', context: 'Rotinas e bem-estar', background: '#051612', primary: '#00FF87', accent: '#60EFFF', text: '#D1FAE5', light: false },
  'cloud-white': { label: 'Cloud White', context: 'Documentos e notas fiscais', background: '#F8FAFC', primary: '#6366F1', accent: '#94A3B8', text: '#1E293B', light: true },
  'neon-skyline': { label: 'Neon Skyline', context: 'Painéis e operações', background: '#2D3748', primary: '#9F7AEA', accent: '#ED8936', accent2: '#4299E1', text: '#F7FAFC', light: false },
  'y2k-arcade': { label: 'Y2K Arcade', context: 'Ideias e experimentos', background: '#1A202C', primary: '#ECC94B', accent: '#805AD5', accent2: '#DD6B20', text: '#E2E8F0', light: false },
} as const;

export type ThemeChoice = 'system' | keyof typeof themes;
export const themeChoices: ThemeChoice[] = ['system', ...Object.keys(themes) as (keyof typeof themes)[]];
export const THEME_STORAGE_KEY = 'brain-core:appearance';

export function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || (!!value && Object.prototype.hasOwnProperty.call(themes, value));
}

export function resolvedTheme(choice: ThemeChoice, systemDark: boolean): keyof typeof themes {
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
}
