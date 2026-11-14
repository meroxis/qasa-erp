import { Fragment, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_PRINTER_CHOICE, MAX_PRINT_COPIES, PRINT_KINDS, PRINTER_MARGINS, PRINTER_PAPERS, USUAL_PAPER,
  type PrinterChoice, type PrinterChoices, type PrinterEntry, type PrinterPaper, type PrintKind
} from '@qasa/core';
import { Icon, useToast } from '../components.tsx';
import { ChoiceTiles } from '../ChoiceTiles.tsx';
import { useI18n, type Key } from '../i18n.ts';
import {
  defaultPrinter, desktopPrinters, PRINT_NOTICE_EVENT, printAlone, printersOf, saveChoice, savedChoices, suggestedChoice, type PrinterInfo, type PrintNotice
} from './printing.ts';

/** A kind's choice with another printer: a first printer starts on the paper that kind usually takes; none is "Ask every time". */
export function withPrinter(kind: PrintKind, current: PrinterChoice | undefined, printer: string | null): PrinterChoice | null {
  if (printer === null) return null;
  return { ...(current ?? { ...DEFAULT_PRINTER_CHOICE, paper: USUAL_PAPER[kind] }), printer };
}

/**
 * The saved printer a choice names that Windows doesn't list now, or null. Such a choice can't be saved (the Windows
 * app takes only printers it lists), so the row asks for another printer instead.
 */
export function goneIn(choice: PrinterChoice | null | undefined, printers: readonly PrinterEntry[] | null): string | null {
  const printer = choice?.printer ?? null;
  if (printer === null || printers === null) return null;
  return printers.some((p) => p.name === printer) ? null : printer;
}

export interface PrintersCardViewProps {
  /** in the Windows app (false: a browser or the website demo) */
  desktop: boolean;
  /** the printers Windows lists (1.4: with the default one, each one's state and what it looks like); null while they are read */
  printers: PrinterInfo[] | null;
  choices: PrinterChoices;
  /** the kind whose change or test page is on its way */
  busy: PrintKind | null;
  error: string | null;
  onChange(kind: PrintKind, choice: PrinterChoice | null): void;
  onTest(kind: PrintKind): void;
  onRefresh(): void;
  /** 1.4: saves the suggested printer for every kind that has none chosen */
  onUseSuggested?(): void;
}

/** 1.4: the printers of this computer as rectangles: Windows' default, ready or offline, and what each looks like. */
export function InstalledPrinters({ printers }: { printers: PrinterInfo[] }) {
  const { t } = useI18n();
  if (printers.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>{t('s14_prnInstalled')}</h3>
      <ul className="printer-tiles" aria-label={t('s14_prnInstalled')}>
        {printers.map((p) => (
          <li key={p.name} className={'printer-tile' + (p.isDefault ? ' default' : '')} data-printer={p.name}>
            <span className="launch-ico"><Icon name="printer" size={18} /></span>
            <span className="printer-tile-text">
              <strong dir="auto">{p.displayName}</strong>
              <span className="printer-tile-chips">
                {p.isDefault && <span className="chip info">{t('s14_prnDefault')}</span>}
                {p.state === 'ready' && <span className="chip ok">{t('s14_prnReady')}</span>}
                {p.state === 'offline' && <span className="chip bad">{t('s14_prnOffline')}</span>}
              </span>
              {p.guess && <span className="muted small">{t('s14_prnLooksLike', { g: t(`s14_prnGuess_${p.guess}` as Key) })}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Settings → Printers as it looks; PrintersCard gives it the Windows app's printers and choices. */
export function PrintersCardView({ desktop, printers, choices, busy, error, onChange, onTest, onRefresh, onUseSuggested }: PrintersCardViewProps) {
  const { t } = useI18n();
  const usual = defaultPrinter(printers);
  // the kinds with no printer chosen that have one to suggest
  const open = printers ? PRINT_KINDS.filter((kind) => !choices[kind]?.printer && suggestedChoice(kind, printers)) : [];
  const detailed = !!printers?.some((p) => p.isDefault || p.state || p.guess);
  const head = <div className="card-head"><h2 id="printers-title"><Icon name="printer" size={18} /> {t('prn_title')}</h2></div>;
  if (!desktop) {
    return (
      <section className="card pad stack" aria-labelledby="printers-title">
        {head}
        <p className="muted" style={{ margin: 0 }}>{t('prn_browser')}</p>
      </section>
    );
  }
  return (
    <section className="card pad stack" aria-labelledby="printers-title" aria-busy={printers === null}>
      {head}
      <p className="muted small" style={{ margin: 0 }}>{t('prn_help')}</p>
      {printers === null && <div className="muted" role="status">{t('prn_loading')}</div>}
      {printers !== null && printers.length === 0 && <div className="alert warn" role="status">{t('prn_none')}</div>}
      {printers !== null && detailed && <InstalledPrinters printers={printers} />}
      {open.length > 0 && onUseSuggested && (
        <div className="alert info printer-suggest" role="status">
          <span>{t('s14_prnSuggestHelp')}</span>
          <button type="button" className="btn small" disabled={busy !== null} onClick={onUseSuggested}>{t('s14_prnUseAll')}</button>
        </div>
      )}
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="table-wrap">
        <table className="table printers-table">
          <thead>
            <tr>
              <th>{t('prn_kind')}</th><th>{t('prn_printer')}</th><th>{t('prn_paper')}</th>
              <th>{t('prn_copies')}</th><th>{t('prn_silent')}</th><th><span className="visually-hidden">{t('prn_test')}</span></th>
            </tr>
          </thead>
          <tbody>
            {PRINT_KINDS.map((kind) => {
              const c = choices[kind];
              const printer = c?.printer ?? null;
              const gone = goneIn(c, printers) !== null;
              // a printer that is gone can't be saved with other settings: only the printer can be changed
              const off = printer === null || gone || busy !== null;
              const label = t(`prn_kind_${kind}` as Key);
              const set = (patch: Partial<PrinterChoice>) => c && onChange(kind, { ...c, ...patch });
              const suggestion = printer === null ? suggestedChoice(kind, printers) : null;
              const suggested = suggestion && (printers ?? []).find((p) => p.name === suggestion.printer);
              const chosen = (printers ?? []).find((p) => p.name === printer);
              // what the list says beside a printer's name: Windows' default, and offline when Windows says so
              const optionLabel = (p: PrinterInfo) => [p.displayName, p.isDefault ? t('s14_prnDefault') : '', p.state === 'offline' ? t('s14_prnOffline') : ''].filter(Boolean).join(' — ');
              // each kind takes two rows: its printer, paper, copies and test page, then its margins as rectangles
              return (
                <Fragment key={kind}>
                <tr className="printers-kind" data-kind={kind}>
                  <td>
                    <strong>{label}</strong>
                    <div className="muted small">{t(`prn_also_${kind}` as Key)}</div>
                  </td>
                  <td>
                    <select className="input" aria-label={`${t('prn_printer')} — ${label}`} value={printer ?? ''} disabled={busy !== null || printers === null}
                      onChange={(e) => onChange(kind, withPrinter(kind, c, e.target.value || null))}>
                      <option value="">{t('prn_ask')}</option>
                      {gone && <option value={printer!}>{printer} — {t('prn_gone')}</option>}
                      {(printers ?? []).map((p) => <option key={p.name} value={p.name}>{optionLabel(p)}</option>)}
                    </select>
                    {gone && (
                      <div className="small" style={{ color: 'var(--warn)' }} role="note">
                        {/* 1.4: with a default printer known, the paper goes there meanwhile (and the page says so each time) */}
                        {usual ? t('s14_prnGoneDefault', { p: printer!, d: usual.displayName }) : t('prn_goneHelp', { p: printer! })} <strong>{t('prn_chooseOther')}</strong>
                      </div>
                    )}
                    {!gone && chosen?.state === 'offline' && (
                      <div className="small" style={{ color: 'var(--warn)' }} role="note">{t('s14_prnOfflineNote', { p: chosen.displayName })}</div>
                    )}
                    {suggestion && suggested && (
                      <div className="small printer-suggestion" role="note">
                        <span className="muted">{t('s14_prnSuggested', { p: suggested.displayName })}</span>
                        <button type="button" className="btn small" disabled={busy !== null} onClick={() => onChange(kind, suggestion)}>{t('s14_prnUse')}</button>
                      </div>
                    )}
                  </td>
                  <td>
                    <select className="input" aria-label={`${t('prn_paper')} — ${label}`} value={c?.paper ?? 'auto'} disabled={off} onChange={(e) => set({ paper: e.target.value as PrinterChoice['paper'] })}>
                      {PRINTER_PAPERS.map((p) => <option key={p} value={p}>{t(`prn_paper_${p}` as Key)}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="input num" aria-label={`${t('prn_copies')} — ${label}`} value={c?.copies ?? 1} disabled={off} onChange={(e) => set({ copies: Number(e.target.value) })}>
                      {Array.from({ length: MAX_PRINT_COPIES }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`${t('prn_silent')} — ${label}`} checked={!!c?.silent} disabled={off} onChange={(e) => set({ silent: e.target.checked })} />
                  </td>
                  <td>
                    <button type="button" className="btn small" disabled={busy !== null} onClick={() => onTest(kind)}><Icon name="printer" size={14} />{t('prn_test')}</button>
                  </td>
                </tr>
                <tr className="printers-margins" data-margins={kind}>
                  <td />
                  <td colSpan={5}>
                    <div className="printers-margins-row">
                      <span className={'printers-margins-label' + (off ? ' muted' : '')}>{t('prn_margins')}</span>
                      <ChoiceTiles
                        label={`${t('prn_margins')} — ${label}`} value={c?.margins ?? 'default'} disabled={off} onChange={(margins) => set({ margins })}
                        options={PRINTER_MARGINS.map((m) => ({ value: m, label: t(`prn_margins_${m}` as Key) }))}
                      />
                    </div>
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="btn" disabled={busy !== null} onClick={onRefresh}>{t('prn_refresh')}</button></div>
    </section>
  );
}

/**
 * Settings → Printers: each person who prints at this PC, admin or not. The choices are this PC's own (kept by the
 * Windows app), not the company's. In a browser it says the browser's print window is used.
 */
export function PrintersCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [desktop] = useState(desktopPrinters);
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null);
  const [choices, setChoices] = useState<PrinterChoices>({});
  const [busy, setBusy] = useState<PrintKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<PrintKind | null>(null);

  const load = useCallback(async (fresh = false) => {
    if (!desktop) return;
    setPrinters(null);
    let list: PrinterInfo[] = [];
    try { list = printersOf(await desktop.list(fresh)); } catch { list = []; }
    setPrinters(list);
    setChoices(await savedChoices(desktop));
  }, [desktop]);
  useEffect(() => { void load(); }, [load]);

  const change = async (kind: PrintKind, choice: PrinterChoice | null) => {
    if (!desktop) return;
    setError(null);
    // a printer that left Windows meanwhile: ask for another, rather than a save error that blames the connection
    const gone = goneIn(choice, printers ?? []);
    if (gone !== null) { setError(t('prn_goneSave', { p: gone })); return; }
    setBusy(kind);
    const saved = await saveChoice(desktop, kind, choice, (printers ?? []).map((p) => p.name));
    setBusy(null);
    if (!saved) { setError(t('prn_saveFailed')); return; }
    setChoices(saved);
    toast(t('prn_saved'));
  };

  /** 1.4: the suggested printer for every kind that has none, one after the other; stops at the first that can't be saved. */
  const useSuggested = async () => {
    if (!desktop || !printers) return;
    setError(null);
    let saved: PrinterChoices | null = null;
    for (const kind of PRINT_KINDS) {
      if (choices[kind]?.printer) continue;
      const choice = suggestedChoice(kind, printers);
      if (!choice) continue;
      setBusy(kind);
      const next = await saveChoice(desktop, kind, choice, printers.map((p) => p.name));
      if (!next) { setBusy(null); setError(t('prn_saveFailed')); if (saved) setChoices(saved); return; }
      saved = next;
    }
    setBusy(null);
    if (saved) { setChoices(saved); toast(t('prn_saved')); }
  };

  // the test page is drawn, then printed alone (body.print-testing hides the app while it prints)
  useEffect(() => {
    if (!testing) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void printAlone(testing, 'print-testing').then((result) => {
        if (live && result === 'printed') toast(t('prn_testSent', { p: choices[testing]?.printer ?? '' }));
      }).finally(() => {
        if (live) { setTesting(null); setBusy(null); }
      });
    }, 50);
    return () => { live = false; window.clearTimeout(timer); };
  }, [testing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PrintersCardView
        desktop={!!desktop} printers={printers} choices={choices} busy={busy} error={error}
        onChange={(kind, choice) => void change(kind, choice)}
        onTest={(kind) => { setBusy(kind); setTesting(kind); }}
        onRefresh={() => void load(true)}
        onUseSuggested={() => void useSuggested()}
      />
      {testing && createPortal(<PrintTestSheet kind={testing} choice={choices[testing]} />, document.body)}
    </>
  );
}

/**
 * The test page's size on each paper, in mm: the sheet (null: as the page allows) and the box to measure. A sheet
 * page or "the printer's usual paper" takes the whole page; a roll is as wide as a receipt on it (72 mm on 80 mm,
 * 48 mm on 58 mm, like pos.css); a label takes the label less 2 mm on each side, with only the few lines that fit.
 */
export interface TestSheetLayout {
  width: number | null;
  height: number | null;
  box: { width: number; height: number };
  fit: 'page' | 'roll' | 'label';
}

export function testSheetLayout(paper: PrinterPaper): TestSheetLayout {
  switch (paper) {
    case 'receipt80': return { width: 72, height: null, box: { width: 50, height: 20 }, fit: 'roll' };
    case 'receipt58': return { width: 48, height: null, box: { width: 40, height: 15 }, fit: 'roll' };
    case 'label50x30': return { width: 46, height: 26, box: { width: 40, height: 10 }, fit: 'label' };
    case 'label38x25': return { width: 34, height: 21, box: { width: 30, height: 8 }, fit: 'label' };
    default: return { width: null, height: null, box: { width: 50, height: 20 }, fit: 'page' };
  }
}

/**
 * A page that shows whether the printer, paper and margins are right, drawn to fit the chosen paper: the names, a box
 * of a known size, and on a page or a roll the three scripts. A label gets the title, printer, paper and box only.
 */
export function PrintTestSheet({ kind, choice }: { kind: PrintKind; choice: PrinterChoice | undefined }) {
  const i18n = useI18n();
  const { t } = i18n;
  const now = new Date();
  const paper = choice?.paper ?? 'auto';
  const layout = testSheetLayout(paper);
  const size = { w: String(layout.box.width), h: String(layout.box.height) };
  const mm = (n: number | null) => (n === null ? undefined : `${n}mm`);
  return (
    <div className="print-test-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
      <div className={`print-test fit-${layout.fit}`} data-paper={paper} style={{ inlineSize: mm(layout.width), blockSize: mm(layout.height) }}>
        {layout.fit === 'label' ? (
          <>
            <strong className="print-test-title">{t('prn_testTitle')}</strong>
            <div dir="auto">{choice?.printer ?? t('prn_ask')}</div>
            <div>{t(`prn_paper_${paper}` as Key)}</div>
          </>
        ) : (
          <>
            <strong className="print-test-title">Qasa ERP — {t('prn_testTitle')}</strong>
            <div>{t('prn_kind')}: {t(`prn_kind_${kind}` as Key)}</div>
            <div>{t('prn_printer')}: <span dir="auto">{choice?.printer ?? t('prn_ask')}</span></div>
            <div>{t('prn_paper')}: {t(`prn_paper_${paper}` as Key)} · {t('prn_margins')}: {t(`prn_margins_${choice?.margins ?? 'default'}` as Key)} · {t('prn_copies')}: {i18n.int(choice?.copies ?? 1)}</div>
            <div>{t('prn_testWhen')}: {i18n.date(now.toISOString().slice(0, 10))} {i18n.digitsOf(now.toTimeString().slice(0, 5))}</div>
          </>
        )}
        <div className="print-test-box" style={{ inlineSize: mm(layout.box.width), blockSize: mm(layout.box.height) }}>
          <span>{t('prn_testBoxSize', size)}</span>
        </div>
        {layout.fit !== 'label' && (
          <>
            <div dir="ltr">عربي · English · کوردی · 0123456789</div>
            <p>{t('prn_testBody', size)}</p>
          </>
        )}
      </div>
    </div>
  );
}

const NOTICE_KEY: Record<PrintNotice['code'], Key> = {
  missing: 'prn_n_missing', noPrinters: 'prn_n_noPrinters', failed: 'prn_n_failed', busy: 'prn_n_busy', fallback: 's14_prn_n_fallback'
};

/** What a Print button has to say about the printer, until it is closed (or after 12 seconds). Never printed. */
export function PrintNotices() {
  const { t } = useI18n();
  const [notice, setNotice] = useState<PrintNotice | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const show = (e: Event) => {
      const detail = (e as CustomEvent<PrintNotice>).detail;
      if (!detail || !(detail.code in NOTICE_KEY)) return;
      setNotice(detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNotice(null), 12_000);
    };
    window.addEventListener(PRINT_NOTICE_EVENT, show);
    return () => { window.removeEventListener(PRINT_NOTICE_EVENT, show); window.clearTimeout(timer); };
  }, []);
  if (!notice) return null;
  return (
    <div className="toast print-notice no-print" role="alert">
      <span>{t(NOTICE_KEY[notice.code], { p: 'printer' in notice ? notice.printer : '', d: 'to' in notice ? notice.to : '' })}</span>
      <button type="button" className="btn small" onClick={() => setNotice(null)}>{t('prn_dismiss')}</button>
    </div>
  );
}
