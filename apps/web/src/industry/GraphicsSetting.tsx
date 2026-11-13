import { useEffect, useState } from 'react';
import type { Lang } from '@qasa/core';
import { Icon } from '../components.tsx';
import { ChoiceTiles } from '../ChoiceTiles.tsx';
import { useI18n } from '../i18n.ts';

/** What the Windows app reports: the saved choice, and whether this window is running with it. */
interface GraphicsState { on: boolean; running: boolean }

interface DesktopGraphics {
  getGraphics?(): Promise<GraphicsState>;
  setGraphics?(on: boolean): Promise<GraphicsState>;
  relaunch?(): void;
}

const TEXT: Record<Lang, { title: string; help: string; on: string; off: string; restart: string; restartNow: string }> = {
  ar: {
    title: 'تسريع الرسوميات',
    help: 'أوقفه إذا كانت النافذة تتجمّد أو تظهر سوداء أو تومض على هذا الحاسوب.',
    on: 'مفعّل', off: 'متوقف',
    restart: 'يُطبَّق التغيير بعد إعادة تشغيل البرنامج.', restartNow: 'إعادة التشغيل الآن',
  },
  en: {
    title: 'Use graphics acceleration',
    help: 'Turn this off if the window freezes, goes black or flickers on this computer.',
    on: 'On', off: 'Off',
    restart: 'The change takes effect when the app restarts.', restartNow: 'Restart now',
  },
  ku: {
    title: 'خێراکردنی گرافیک',
    help: 'ئەگەر پەنجەرەکە دەوەستێت، ڕەش دەبێت یان دەلەرزێت لەم کۆمپیوتەرەدا، بیکوژێنەرەوە.',
    on: 'کارا', off: 'ناکارا',
    restart: 'گۆڕانکارییەکە دوای دووبارە کردنەوەی بەرنامەکە جێبەجێ دەبێت.', restartNow: 'ئێستا دووبارە بیکەرەوە',
  },
};

/**
 * Settings → Display, Windows app only: graphics acceleration on or off. Hidden in a browser, where the browser decides.
 * The choice is saved by the app (graphics.json) and applies from the next start.
 */
export function GraphicsSetting() {
  const { lang } = useI18n();
  const desktop = (window as unknown as { qasaDesktop?: DesktopGraphics }).qasaDesktop;
  const [state, setState] = useState<GraphicsState | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    desktop?.getGraphics?.().then((s) => { if (live) setState(s); }).catch(() => undefined);
    return () => { live = false; };
  }, [desktop]);
  if (!desktop?.getGraphics || !desktop.setGraphics || !state) return null;
  const tx = TEXT[lang] ?? TEXT.en;
  const choose = (on: boolean) => {
    if (on === state.on || saving) return;
    setSaving(true);
    desktop.setGraphics!(on).then(setState).catch(() => undefined).finally(() => setSaving(false));
  };
  const pending = state.on !== state.running;
  return (
    <div className="setting">
      <Icon name="zap" size={20} className="setting-icon" />
      <div className="setting-text">
        <strong>{tx.title}</strong>
        <span>{tx.help}</span>
        {pending && (
          <span role="status">
            {tx.restart}{' '}
            {desktop.relaunch && <button type="button" className="link-btn" onClick={() => desktop.relaunch!()}>{tx.restartNow}</button>}
          </span>
        )}
      </div>
      <div className="setting-ctl">
        <ChoiceTiles
          label={tx.title} value={state.on ? 'on' : 'off'} disabled={saving} busy={saving} onChange={(v) => choose(v === 'on')}
          options={[{ value: 'on', label: tx.on, icon: 'zap' }, { value: 'off', label: tx.off, icon: 'x' }]}
        />
      </div>
    </div>
  );
}
