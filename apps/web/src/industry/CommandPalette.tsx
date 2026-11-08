import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api.ts';
import { Icon } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { addRecent, allPages, recents, type NavViewer, type Recent } from '../nav.ts';
import { go } from '../router.ts';
import { showTour } from './Tour.tsx';

interface Hit extends Recent { section: Key; action?: () => void }

const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[ىي]/g, 'ی').replace(/ك/g, 'ک').replace(/[إأآ]/g, 'ا').trim();

/**
 * Search everything (Ctrl+K): the pages this person may open, and as they type, customers and suppliers, items (code,
 * barcode, names in all three languages) and invoices and vouchers by number. Arrow keys move, Enter opens.
 */
export function CommandPalette({ viewer, onClose }: { viewer: NavViewer; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    input.current?.focus();
    const back = opener.current;
    return () => { if (back instanceof HTMLElement) back.focus(); };
  }, []);

  const pages = useMemo(() => allPages(viewer).map((p): Hit => ({
    kind: 'page', label: t(p.key), sub: t(p.group), path: p.path ?? '', icon: p.icon, section: 'searchPages'
  })).concat({ kind: 'page', label: t('tour_show'), sub: t('us_helpTitle'), path: '', icon: 'circle', section: 'searchPages', action: showTour }), [viewer, t]);

  // records: asked once the person stops typing for a moment, a few of each
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setFound([]); setBusy(false); return; }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      const take = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
      void Promise.all([
        take(api.parties({ q: text })),
        take(api.items({ q: text })),
        take(api.invoices({ q: text })),
        take(api.entries({ q: text }))
      ]).then(([parties, items, invoices, entries]) => {
        if (!live) return;
        const hits: Hit[] = [
          ...parties.slice(0, 5).map((p): Hit => ({
            kind: 'party', label: p.name, sub: [p.code, p.phone, t(p.type === 'customer' ? 'customers' : 'suppliers')].filter(Boolean).join(' · '),
            path: `party/${p.id}`, icon: p.type === 'customer' ? 'contact' : 'truck', section: 'searchParties'
          })),
          ...items.slice(0, 5).map((it): Hit => ({
            kind: 'item', label: i18n.name(it.name), sub: [it.code, it.barcode].filter(Boolean).join(' · '), path: `item/${it.id}`, icon: 'box', section: 'searchItems'
          })),
          ...invoices.filter((v) => v.number).slice(0, 4).map((v): Hit => ({
            kind: 'invoice', label: v.number ?? '', sub: [v.partyName, i18n.date(v.date)].filter(Boolean).join(' · '), path: `invoice/${v.id}`, icon: 'invoice', section: 'searchDocs'
          })),
          ...entries.filter((e) => e.number).slice(0, 4).map((e): Hit => ({
            kind: 'entry', label: e.number ?? '', sub: [e.party ?? e.description, i18n.date(e.date)].filter(Boolean).join(' · '), path: `entry/${e.id}`, icon: 'receipt', section: 'searchDocs'
          }))
        ];
        setFound(hits);
        setBusy(false);
      });
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [q, i18n, t]);

  const results: Hit[] = useMemo(() => {
    const text = norm(q);
    if (!text) return [...recents().map((r) => ({ ...r, section: 'searchRecent' as Key })), ...pages];
    return [...pages.filter((p) => norm(p.label).includes(text) || norm(p.sub ?? '').includes(text)), ...found];
  }, [q, pages, found]);

  useEffect(() => { setIndex(0); }, [q, found]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  function open(hit: Hit) {
    if (hit.action) { onClose(); hit.action(); return; }
    addRecent({ kind: hit.kind, label: hit.label, ...(hit.sub ? { sub: hit.sub } : {}), path: hit.path, icon: hit.icon });
    onClose();
    go(hit.path);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const hit = results[index]; if (hit) open(hit); }
  }

  let lastSection = '';
  return (
    <div className="backdrop palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('searchHint')} onKeyDown={onKey}>
        <div className="palette-head">
          <Icon name="search" size={18} />
          <input
            ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchHint')} aria-label={t('searchHint')}
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[index] ? `palette-${index}` : undefined} autoComplete="off"
          />
          {busy && <span className="spinner small" aria-hidden="true" />}
          <kbd className="ltr">Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {results.length === 0 && !busy && <div className="palette-empty">{t('searchNoResults')}</div>}
          {results.map((hit, i) => {
            const head = hit.section !== lastSection ? <div key={'h' + i} className="palette-section" role="presentation">{t(hit.section)}</div> : null;
            lastSection = hit.section;
            return (
              <div key={hit.section + hit.path + i} style={{ display: 'contents' }}>
                {head}
                <button
                  type="button" id={`palette-${i}`} data-i={i} role="option" aria-selected={i === index}
                  className={'palette-item' + (i === index ? ' active' : '')} onMouseEnter={() => setIndex(i)} onClick={() => open(hit)}
                >
                  <span className="palette-ico"><Icon name={hit.icon} size={17} /></span>
                  <span className="palette-text"><strong className="bidi">{hit.label}</strong>{hit.sub && <span className="bidi">{hit.sub}</span>}</span>
                  {i === index && <Icon name="chevron" size={14} className="flip" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">{t('searchKeys')}</div>
      </div>
    </div>
  );
}
