import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { creditNames, PRODUCT_SOURCE_NAMES, publicBarcode, type ProductSource } from '@qasa/core';
import { ErrorBox, Icon, Modal, useMay } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { refreshItemImages, type PreparedPicture } from './ItemImage.tsx';
import { western } from './item-quick-add.ts';
import { productLookupApi, type BulkStatus, type LookupSettings, type NameSuggestion, type ProductLookupResult } from './product-lookup-api.ts';

/**
 * Product lookup in the web app (2.1): when an item is added with a manufacturer's barcode, its picture and name are
 * looked for in the open product databases, by the app's own server (packages/server/src/product-lookup.ts). Off
 * until an admin switches it on; the form never waits for it and works the same without it.
 */

/* ---------- the setting, known once per visit ---------- */

let settings: LookupSettings | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function loadSettings(): void {
  if (loading) return;
  // an office server from before 2.1 has no such setting: the lookup is simply not there
  loading = productLookupApi.settings().then((s) => { settings = s; }, () => { settings = { enabled: false, asked: true, available: false }; }).finally(notify);
}
/** Tests, and a change of company: forget what was known. */
export function forgetLookupSettings(): void { settings = null; loading = null; }

export function useLookupSettings(): LookupSettings | null {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); loadSettings(); return () => listeners.delete(onChange); },
    () => settings,
    () => null
  );
}
async function saveLookupSetting(enabled: boolean): Promise<void> {
  settings = await productLookupApi.saveSettings(enabled);
  notify();
}

/** "Picture from Open Food Facts · CC BY-SA": the line under a picture that came from one of the databases. */
export function PictureSourceLine({ source }: { source: ProductSource }) {
  const { t } = useI18n();
  return <span className="muted small">{t('plk_from', { s: PRODUCT_SOURCE_NAMES[source] })} · <span className="ltr">CC BY-SA</span></span>;
}

/** The credit a page that shows such pictures to the public carries (the price checker's footer, a printed document). */
export function PictureCredit({ sources }: { sources: readonly ProductSource[] }) {
  const { t } = useI18n();
  if (sources.length === 0) return null;
  return <div className="muted small picture-credit" style={{ fontSize: 11 }}>{t('plk_credit', { s: creditNames(sources) })}</div>;
}

/* ---------- in the add-item forms ---------- */

type Found = { code: string; state: 'looking' } | { code: string; state: 'done'; result: ProductLookupResult };

/**
 * What the form shows under the barcode: nothing (no manufacturer's barcode, the setting off, an old server), the
 * one-time question (an admin, while nobody has answered it), "looking…", or what was found.
 */
export function lookupShows(known: LookupSettings | null, code: string | null, may: { look: boolean; setUp: boolean }, found: Found | null): 'nothing' | 'ask' | 'looking' | 'result' {
  if (!known?.available || !code) return 'nothing';
  if (!known.enabled) return !known.asked && may.setUp ? 'ask' : 'nothing';
  if (!may.look || !found || found.code !== code) return 'nothing';
  if (found.state === 'looking') return 'looking';
  // the shop's own code, or the setting switched off meanwhile: nothing to say
  return !found.result.found && (found.result.reason === 'own' || found.result.reason === 'off') ? 'nothing' : 'result';
}

/**
 * The form's picture once a lookup has answered: the found picture, unless the person chose one of their own
 * meanwhile (theirs stays). `undefined`: the form's picture stays as it is.
 */
export function pictureAfterLookup(result: ProductLookupResult, current: PreparedPicture | null, code: string): PreparedPicture | undefined {
  if (!result.found || !result.image || !result.source) return undefined;
  if (current && !current.lookupBarcode) return undefined;
  return { data: result.image.data, mime: result.image.mime, lookupBarcode: code, source: result.source };
}

/** The one-time question, in plain words: what is sent, to whom, and that it can be changed later. */
export function LookupAsk({ busy, error, onAnswer }: { busy: boolean; error: unknown; onAnswer(on: boolean): void }) {
  const { t } = useI18n();
  return (
    <div className="alert info stack product-lookup-ask" style={{ gap: 8 }} role="group" aria-label={t('plk_askTitle')}>
      <strong>{t('plk_askTitle')}</strong>
      <span className="small">{t('plk_explain')}</span>
      <span className="muted small">{t('plk_changeLater')}</span>
      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => onAnswer(true)}>{t('plk_turnOn')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => onAnswer(false)}>{t('plk_notNow')}</button>
      </div>
    </div>
  );
}

/**
 * What a lookup found: the picture with "Use this picture" (ticked while the form's picture is that one) and its
 * source, and the names as buttons: a name is filled only when its button is pressed. Nothing found: one quiet line.
 */
export function LookupResultView({ code, result, picture, onPicture, onName }: {
  code: string; result: ProductLookupResult; picture: PreparedPicture | null;
  onPicture(picture: PreparedPicture | null): void; onName(name: NameSuggestion): void;
}) {
  const { t } = useI18n();
  const image = result.found ? result.image ?? null : null;
  const names = result.found ? result.names ?? [] : [];
  const used = !!image && picture?.lookupBarcode === code;
  return (
    <div className="stack product-lookup" style={{ gap: 8 }} role="status">
      {image && result.source ? (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'nowrap' }}>
          <img src={`data:${image.mime};base64,${image.data}`} alt={t('plk_found')} width={56} height={56}
            style={{ inlineSize: 56, blockSize: 56, objectFit: 'contain', borderRadius: 'var(--r-md)', background: 'var(--surface)', flexShrink: 0 }} />
          <div className="stack" style={{ gap: 2, minInlineSize: 0 }}>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={used}
                onChange={(e) => onPicture(e.target.checked ? { data: image.data, mime: image.mime, lookupBarcode: code, source: result.source! } : null)} />
              {t('plk_useThis')}
            </label>
            <PictureSourceLine source={result.source} />
          </div>
        </div>
      ) : !picture && <span className="muted small">{t(result.found ? 'plk_noneNames' : 'plk_none')}</span>}
      {names.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">{t('plk_names')}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {names.map((n) => (
              <button key={`${n.lang}:${n.text}`} type="button" className="btn small" dir="auto" lang={n.lang === 'ku' ? 'ckb' : n.lang} onClick={() => onName(n)}>{n.text}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Under the barcode of a new item. With the setting on, it looks the barcode up a moment after it is typed or scanned
 * and shows what was found; the form never waits for it. Nothing found, no internet, an old server: one quiet line,
 * and the picture is added by hand as always. With the setting never answered, an admin is asked once.
 *
 * `picture`: the form's picture (the person's own, or the found one with its `lookupBarcode`).
 */
export function ProductLookupPanel({ barcode, picture, onPicture, onName }: {
  barcode: string;
  picture: PreparedPicture | null;
  onPicture(picture: PreparedPicture | null): void;
  onName(name: NameSuggestion): void;
}) {
  const { t } = useI18n();
  const can = useMay();
  const known = useLookupSettings();
  const code = publicBarcode(western(barcode));
  const [found, setFound] = useState<Found | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // the form's picture and callbacks as they are now, for an answer that arrives later
  const now = useRef({ picture, onPicture });
  now.current = { picture, onPicture };
  const mayLook = can('productLookup');
  const enabled = !!known?.enabled && mayLook;

  useEffect(() => {
    // another barcode (or none): a picture found for the one before does not belong to this item
    const mine = now.current.picture;
    if (mine?.lookupBarcode && mine.lookupBarcode !== code) now.current.onPicture(null);
    if (!enabled || !code) { setFound(null); return; }
    let live = true;
    setFound({ code, state: 'looking' });
    // a moment after the last key: a barcode typed by hand is not asked about digit by digit
    const timer = window.setTimeout(() => {
      productLookupApi.lookup(code).catch((): ProductLookupResult => ({ found: false, reason: 'unreachable' })).then((result) => {
        if (!live) return;
        setFound({ code, state: 'done', result });
        const next = pictureAfterLookup(result, now.current.picture, code);
        if (next) now.current.onPicture(next);
      });
    }, 500);
    return () => { live = false; window.clearTimeout(timer); };
  }, [code, enabled]);

  const shows = lookupShows(known, code, { look: mayLook, setUp: can('productLookupSetup') }, found);
  if (shows === 'nothing' || !code) return null;
  if (shows === 'ask') {
    const answer = async (on: boolean) => {
      setAsking(true);
      setError(null);
      try { await saveLookupSetting(on); } catch (e) { setError(e); } finally { setAsking(false); }
    };
    return <LookupAsk busy={asking} error={error} onAnswer={(on) => void answer(on)} />;
  }
  if (shows === 'looking' || found?.state !== 'done') return <div className="muted small product-lookup" role="status">{t('plk_looking')}</div>;
  return <LookupResultView code={code} result={found.result} picture={picture} onPicture={onPicture} onName={onName} />;
}

/* ---------- Settings ---------- */

/** The switch, with what it sends and to whom, in plain words. */
export function LookupSettingView({ known, busy, error, onChange }: { known: LookupSettings; busy: boolean; error: unknown; onChange(on: boolean): void }) {
  const { t } = useI18n();
  return (
    <div className="card pad stack">
      <h2>{t('plk_title')}</h2>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={known.enabled} disabled={busy || !known.available} onChange={(e) => onChange(e.target.checked)} />
        {t('plk_setting')}
      </label>
      <div className="muted small">{t('plk_explain')}</div>
      <div className="muted small">{known.available ? t('plk_offNote') : t('plk_unavailable')}</div>
      <ErrorBox error={error} />
    </div>
  );
}

/** Settings → Sales: "Look up product pictures and names online". An admin's; off until switched on. */
export function ProductLookupSettingCard() {
  const known = useLookupSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!known) return null;
  const change = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try { await saveLookupSetting(on); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return <LookupSettingView known={known} busy={busy} error={error} onChange={(on) => void change(on)} />;
}

/* ---------- the items list: pictures for every item that has none ---------- */

const END_TEXT = { done: 'plk_endDone', stopped: 'plk_endStopped', off: 'plk_endOff', unreachable: 'plk_endUnreachable' } as const;

/**
 * "Find pictures for items without one" (an admin, with the setting on): starts the search on the server, shows how
 * far it is, and can stop it. The search goes on when the window is closed; opening it again shows where it is.
 */
export function FindPicturesButton({ onAdded }: { onAdded?: () => void }) {
  const { t } = useI18n();
  const can = useMay();
  const known = useLookupSettings();
  const [open, setOpen] = useState(false);
  if (!known?.available || !known.enabled || !can('productLookupAll')) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="search" size={16} />{t('plk_findAll')}</button>
      {open && <FindPicturesDialog onClose={() => setOpen(false)} {...(onAdded ? { onAdded } : {})} />}
    </>
  );
}

/** How far the search is, and how it ended. */
export function BulkStatusView({ status }: { status: BulkStatus }) {
  const { t } = useI18n();
  if (!status.running && !status.ended) return null;
  return (
    <div className="stack" style={{ gap: 6 }} role="status">
      {status.total > 0 && <progress value={status.done} max={status.total} style={{ inlineSize: '100%' }} aria-label={t('plk_findAll')} />}
      {status.total > 0 && <span>{t('plk_progress', { done: status.done, total: status.total, added: status.added })}</span>}
      {status.running ? <span className="muted small">{t('plk_running')}</span>
        : status.ended && <span className={status.ended === 'unreachable' || status.ended === 'off' ? 'alert warn small' : 'muted small'}>
          {status.ended === 'done' && status.total === 0 ? t('plk_nothingToFind') : t(END_TEXT[status.ended])}
        </span>}
    </div>
  );
}

export function FindPicturesDialog({ onClose, onAdded }: { onClose(): void; onAdded?: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BulkStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const added = useRef(0);
  const take = (s: BulkStatus) => {
    setStatus(s);
    // the lists learn of new pictures as they come
    if (s.added !== added.current) { added.current = s.added; refreshItemImages(); onAdded?.(); }
  };
  useEffect(() => {
    let live = true;
    const read = () => productLookupApi.bulk().then((s) => { if (live) take(s); }, (e: unknown) => { if (live) setError(e); });
    void read();
    const timer = window.setInterval(() => { void read(); }, 3000);
    return () => { live = false; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const act = async (what: 'start' | 'stop') => {
    setBusy(true);
    setError(null);
    try { take(what === 'start' ? await productLookupApi.startBulk() : await productLookupApi.stopBulk()); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('plk_findAll')} onClose={onClose}>
      <div className="stack">
        <div className="muted small">{t('plk_findAllHelp')}</div>
        {status && <BulkStatusView status={status} />}
        <ErrorBox error={error} />
        <div className="row">
          {status?.running
            ? <button type="button" className="btn" disabled={busy} onClick={() => void act('stop')}><Icon name="x" size={16} />{t('plk_stop')}</button>
            : <button type="button" className="btn primary" disabled={busy || !status} onClick={() => void act('start')}><Icon name="search" size={16} />{t('plk_start')}</button>}
          <button type="button" className="btn" onClick={onClose}>{t('plk_close')}</button>
        </div>
      </div>
    </Modal>
  );
}
