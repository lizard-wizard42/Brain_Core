import { BrowserRecorderControl } from './BrowserRecorderControl';

export function RememberRecorderControl() {
  const isAndroidApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('BrainCoreAndroid/1');
  if (!isAndroidApp) return <BrowserRecorderControl />;
  return <section aria-label="Gravação no celular" className="rounded-[26px] border p-5 sm:p-7" style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-border)' }}>
    <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-text)' }}>Gravação neste celular</h2>
    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--theme-muted)' }}>O áudio fica salvo no aparelho e é enviado ao PC para transcrição quando a sincronização estiver disponível.</p>
    <a href="braincore://capture" className="mt-5 flex min-h-14 w-full items-center justify-center rounded-2xl bg-blue-700 px-6 text-base font-semibold text-white hover:bg-blue-600">🎙 Gravar neste celular</a>
  </section>;
}
