import { useRef, useState } from 'react';
import type { Names } from '@qasa/core';
import { useI18n } from '../i18n.ts';
import { namesDiffer, sameName, shownLang, withOneName } from './names.ts';

/**
 * The one name field of an item, a category or a warehouse: typed in any language and used in all three. A record that
 * already holds a different text per language shows the text of the language on screen, with a small link to the
 * three texts; nothing is lost by saving.
 */
export function NameField({ label, value, onChange, autoFocus }: { label: string; value: Names; onChange(names: Names): void; autoFocus?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  // decided once, when the form opens: typing must not flip between one text and three
  const differs = useRef(namesDiffer(value)).current;
  const own = useRef(differs ? shownLang(value, i18n.lang) : null).current;
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <label className="field"><span>{t('nameAr')}</span><input className="input" lang="ar" dir="rtl" maxLength={200} value={value.ar} onChange={(e) => onChange({ ...value, ar: e.target.value })} /></label>
        <label className="field"><span>{t('nameKu')}</span><input className="input" lang="ckb" dir="rtl" maxLength={200} value={value.ku} onChange={(e) => onChange({ ...value, ku: e.target.value })} /></label>
        <label className="field"><span>{t('nameEn')}</span><input className="input" lang="en" dir="ltr" maxLength={200} value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} /></label>
        <div><button type="button" className="btn small ghost" onClick={() => { onChange(sameName(value[shownLang(value, i18n.lang)])); setOpen(false); }}>{t('it_namesOne')}</button></div>
      </div>
    );
  }
  const text = own ? value[own] : value[shownLang(value, i18n.lang)];
  // after "one name for every language" the three are the same text again: the field writes all three
  const single = !differs || !namesDiffer(value);
  return (
    <div className="field">
      <label className="field">
        <span>{label}</span>
        <input className="input" dir="auto" maxLength={200} value={text} onChange={(e) => onChange(withOneName(value, e.target.value, single ? null : own))} autoFocus={autoFocus} />
      </label>
      {differs && namesDiffer(value) && <div><button type="button" className="btn small ghost" onClick={() => setOpen(true)}>{t('it_namesDiffer')}</button></div>}
    </div>
  );
}
