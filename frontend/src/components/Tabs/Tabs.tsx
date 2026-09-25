import React from 'react';
import type { Tab } from '../../hooks/useTabs';

interface TabsProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabClick: (id: string) => void;
  onTabClose: (id: string, e: React.MouseEvent) => void;
  onNewTab: () => void;
  onGoBack: () => void;
  onGoHome: () => void;
}

function isCustomIconUrl(icon: string | null | undefined): boolean {
  return typeof icon === 'string' && /^\/|^https?:\/\//.test(icon);
}

function renderPageIcon(icon: string | null | undefined, fallback = '📄') {
  if (isCustomIconUrl(icon)) {
    return (
      <img
        src={icon as string}
        alt=""
        className="w-3.5 h-3.5 object-contain rounded"
      />
    );
  }
  return icon || fallback;
}

export function Tabs({ tabs, activeTabId, onTabClick, onTabClose, onNewTab, onGoBack, onGoHome }: TabsProps) {
  return (
    <div className="flex items-start bg-[#111111] border-b border-[#1f1f1f] min-h-10 px-1.5 py-1 shrink-0">
      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-white/10 shrink-0">
        <button type="button" onClick={onGoHome} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-white/10 hover:text-white active:scale-95" aria-label="Ir para o dashboard" title="Dashboard">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>
        </button>
        <button type="button" onClick={onGoBack} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-white/10 hover:text-white active:scale-95" aria-label="Voltar" title="Voltar">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>
        </button>
      </div>
      <div className="flex items-start gap-1 min-h-full overflow-x-auto no-scrollbar min-w-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => onTabClick(tab.id)}
            className={`
              group flex items-start gap-1.5 min-h-8 px-2 py-1 rounded-md cursor-pointer transition-colors text-[11px] select-none
              ${activeTabId === tab.id 
                ? 'bg-[#191919] text-gray-200 border border-[#2a2a2a]' 
                : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}
            `}
          >
            <span className="shrink-0 flex items-center justify-center w-4 h-4 mt-0.5">
              {renderPageIcon(tab.icon)}
            </span>
            <span className="min-w-0 max-w-[116px] md:max-w-[156px] truncate leading-5" title={tab.title}>
              {tab.title}
            </span>
            <button
              aria-label={'Fechar ' + tab.title}
              onClick={(e) => onTabClose(tab.id, e)}
              className={`
                ml-0.5 mt-0.5 flex h-5 w-5 items-center justify-center rounded-sm hover:bg-white/10 hover:text-white transition-colors shrink-0
                ${activeTabId === tab.id ? 'opacity-100' : 'opacity-70 md:opacity-0 md:group-hover:opacity-100'}
              `}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M1 1L9 9M9 1L1 9" />
              </svg>
            </button>
          </div>
        ))}
        <button type="button" onClick={onNewTab} className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200" aria-label="Abrir nova guia" title="Nova guia">+</button>
      </div>
    </div>
  );
}
