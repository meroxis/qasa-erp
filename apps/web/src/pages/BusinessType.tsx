import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MAX_EXTRA_BUSINESS_TYPES, starterTradeFor, type BusinessType } from '@qasa/core';
import { api, type Settings } from '../api.ts';
import { ErrorBox, Icon, LanguageSwitch, useData, useToast } from '../components.tsx';
import { makeI18n, useI18n, type Key } from '../i18n.ts';
import { AgreeLine } from '../industry/LegalPanel.tsx';
import { StarterListButton } from '../industry/CatalogPickers.tsx';
import { BusinessArt } from '../industry/BusinessArt.tsx';
import {
  BUSINESS_CARDS, BUSINESS_GROUPS, cardOf, lineKey, matchCards, nextIndex, planLine, SUGGESTED_TYPE, titleKey, type BusinessCard
} from '../industry/business-cards.ts';
import { go } from '../router.ts';

/**
 * Saves the company's choice: the main type and, when given, what it also does. A server from before 1.7 (an office
 * server not updated yet: its settings have no `businessType`) only knows the list, so it gets the list, main first.
 */
export async function saveBusinessChoice(settings: Settings | null, main: BusinessType, extras?: readonly BusinessType[]): Promise<Settings> {
  if (settings && settings.businessType === undefined) {
    const others = extras ?? (settings.businessTypes ?? []).filter((t) => t !== main);
    return api.updateSettings({ businessTypes: [main, ...others] });
  }
  return api.updateSettings({ businessType: main, ...(extras ? { businessTypesExtra: [...extras] } : {}) });
}

/** The company's main type and extras as this app reads them (a server from before 1.7 sends only the list). */
export function choiceOf(settings: Settings | null): { main: BusinessType | null; extras: BusinessType[] } {
  if (!settings?.businessTypes) return { main: null, extras: [] };
  if (settings.businessType !== undefined) return { main: settings.businessType, extras: settings.businessTypesExtra ?? [] };
  const list = settings.businessTypes;
  const main = list.find((t) => t !== 'trade') ?? list[0] ?? null;
  return { main, extras: list.filter((t) => t !== main) };
}

/**
 * The cards, one choice: grouped, with a search box. The list is a radio group: arrows move (and choose), Home and End
 * jump, Enter goes on with the one chosen (`onActivate`).
 */
export function BusinessPicker({ value, onPick, onActivate }: { value: BusinessType; onPick(type: BusinessType): void; onActivate?(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [query, setQuery] = useState('');
  const english = useMemo(() => makeI18n('en', 'western', () => {}, () => {}), []);
  const shown = useMemo(
    () => matchCards(BUSINESS_CARDS, query, (c) => [t(titleKey(c.type)), t(lineKey(c.type)), english.t(titleKey(c.type)), english.t(lineKey(c.type))]),
    [query, t, english]
  );
  const refs = useRef(new Map<BusinessType, HTMLButtonElement>());
  // the card that takes Tab: the chosen one when it is shown, else the first shown
  const tabStop = shown.some((c) => c.type === value) ? value : shown[0]?.type;

  function onKey(e: KeyboardEvent<HTMLButtonElement>, type: BusinessType) {
    if (e.key === 'Enter') { e.preventDefault(); onPick(type); onActivate?.(); return; }
    const at = shown.findIndex((c) => c.type === type);
    const next = nextIndex(at, e.key, shown.length, i18n.lang !== 'en');
    if (next === null) return;
    e.preventDefault();
    const card = shown[next]!;
    onPick(card.type);
    refs.current.get(card.type)?.focus();
  }

  return (
    <div className="biz-picker">
      <label className="biz-search">
        <Icon name="search" size={18} />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('bc_search')} aria-label={t('bc_search')} />
      </label>
      <div role="radiogroup" aria-label={t('bc_list')} className="biz-groups">
        {BUSINESS_GROUPS.map((group) => {
          const cards = shown.filter((c) => c.group === group);
          if (!cards.length) return null;
          return (
            <section key={group} className="biz-group" aria-labelledby={`biz-g-${group}`}>
              <h3 id={`biz-g-${group}`}>{t(`bc_group_${group}` as Key)}</h3>
              <div className="biz-grid">
                {cards.map((c) => (
                  <button
                    key={c.type}
                    ref={(el) => { if (el) refs.current.set(c.type, el); else refs.current.delete(c.type); }}
                    type="button"
                    role="radio"
                    aria-checked={c.type === value}
                    tabIndex={c.type === tabStop ? 0 : -1}
                    className={'biz-card' + (c.type === value ? ' on' : '')}
                    onClick={() => onPick(c.type)}
                    onDoubleClick={() => { onPick(c.type); onActivate?.(); }}
                    onKeyDown={(e) => onKey(e, c.type)}
                  >
                    <BusinessArt type={c.type} group={c.group} />
                    <span className="biz-text">
                      <strong>{t(titleKey(c.type))}</strong>
                      <span>{t(lineKey(c.type))}</span>
                      {c.type === SUGGESTED_TYPE && <em className="biz-suggested">{t('bc_suggested')}</em>}
                    </span>
                    <span className="biz-check" aria-hidden="true"><Icon name="check" size={14} /></span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {!shown.length && <p className="muted biz-none" role="status">{t('bc_noMatch')}</p>}
      </div>
    </div>
  );
}

/** The chosen card, told in full: what the menu will have, and the plan. `children`: the buttons under it. */
export function BusinessPreview({ type, children }: { type: BusinessType; children?: ReactNode }) {
  const { t } = useI18n();
  const { plan } = useData();
  const card = cardOf(type) ?? ({ type, group: 'shops', pages: [] } as BusinessCard);
  const line = planLine(type, plan);
  return (
    <aside className="biz-preview" aria-live="polite">
      <div className="biz-preview-head">
        <BusinessArt type={type} group={card.group} size={72} />
        <div>
          <h3>{t(titleKey(type))}</h3>
          <p>{t(lineKey(type))}</p>
        </div>
      </div>
      {card.pages.length > 0 && (
        <div className="biz-pages">
          <strong>{t('bc_youGet')}</strong>
          <ul>{card.pages.map((p) => <li key={p}><Icon name="check" size={14} />{t(p)}</li>)}</ul>
          <p className="muted small">{t('bc_alwaysThere')}</p>
        </div>
      )}
      <p className="biz-plan"><Icon name="star" size={14} />{t(line.key, { p: line.plan ? t(`plan_${line.plan}` as Key) : '' })}</p>
      <div className="biz-preview-actions">{children}</div>
    </aside>
  );
}

/**
 * "What does your company mainly do?": the first screen of a new company (full screen, before anything else). One
 * choice; general trade is offered first. Starting also starts the free first month, as before.
 */
export function BusinessTypeChooser({ onDone, first }: { onDone?: () => void; first?: boolean }) {
  const { t } = useI18n();
  const { settings, plan, reloadSettings, reloadPlan } = useData();
  const toast = useToast();
  const [picked, setPicked] = useState<BusinessType>(choiceOf(settings).main ?? SUGGESTED_TYPE);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function start() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveBusinessChoice(settings, picked);
      // the first month's free trial (every paid feature) starts by itself the first time
      if (first && plan?.trialAvailable) {
        try { await api.startTrial(); reloadPlan(); } catch { /* the plan page offers it again */ }
      }
      reloadSettings();
      toast(t('saved'));
      // a market works at the till: a new one opens there
      if (first && picked === 'market') go('pos');
      onDone?.();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="biz-chooser">
      <header className="biz-head">
        {/* the first screen of a new company comes before Settings can be reached, so the language is chosen here too */}
        {first && <LanguageSwitch className="biz-lang" />}
        <div>
          <h2 id="biz-title">{t(first ? 'bizWelcome' : 'bizType')}</h2>
          <p className="biz-question">{t('bc_question')}</p>
          <p className="muted">{t('bc_questionHelp')}</p>
        </div>
      </header>
      <div className="biz-layout">
        <BusinessPicker value={picked} onPick={setPicked} onActivate={() => void start()} />
        <BusinessPreview type={picked}>
          <ErrorBox error={error} />
          {first && <AgreeLine />}
          <button type="button" className="btn primary biz-start" disabled={saving} onClick={() => void start()}>
            {t('bc_startAs', { t: t(titleKey(picked)) })}
          </button>
          {/* categories and brands for the trade: only when pressed, never by themselves */}
          <details className="biz-lists">
            <summary>{t('bc_starterLists')}</summary>
            <StarterListButton key={starterTradeFor([picked])} trade={starterTradeFor([picked])} />
          </details>
        </BusinessPreview>
      </div>
    </div>
  );
}

/** System → Business type: the main kind of work (changed with a confirm), and "My company also does…". */
export function BusinessTypePage() {
  const { t } = useI18n();
  const { settings, reloadSettings } = useData();
  const toast = useToast();
  const now = choiceOf(settings);
  const main = now.main ?? SUGGESTED_TYPE;
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<BusinessType>(main);
  const [confirming, setConfirming] = useState(false);
  const [alsoOn, setAlsoOn] = useState(now.extras.length > 0);
  const [extras, setExtras] = useState<BusinessType[]>(now.extras);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const mainCard = cardOf(main);

  async function run(job: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await job();
      reloadSettings();
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const changeMain = () => run(async () => {
    await saveBusinessChoice(settings, picked);
    setConfirming(false);
    setChanging(false);
    setExtras((list) => list.filter((x) => x !== picked));
  });

  const chosenExtras = alsoOn ? extras : [];
  const extrasDirty = chosenExtras.join() !== now.extras.join();
  // more than two only when kept from before 1.7: they stay (and may come back), but no new one joins them
  const many = now.extras.length > MAX_EXTRA_BUSINESS_TYPES;
  const blocked = (type: BusinessType) => extras.length >= MAX_EXTRA_BUSINESS_TYPES && !now.extras.includes(type);
  const toggle = (type: BusinessType) => setExtras((list) => (list.includes(type) ? list.filter((x) => x !== type) : [...list, type]));

  return (
    <div className="card pad stack biz-page">
      <section className="stack" aria-labelledby="biz-main">
        <h2 id="biz-main">{t('bc_mainTitle')}</h2>
        {!changing ? (
          <div className="biz-current">
            <BusinessArt type={main} group={mainCard?.group ?? 'shops'} size={56} />
            <div className="biz-text">
              <strong>{t(titleKey(main))}</strong>
              <span className="muted">{t(lineKey(main))}</span>
            </div>
            <button type="button" className="btn" onClick={() => { setPicked(main); setChanging(true); }}>{t('bc_change')}</button>
          </div>
        ) : (
          <div className="biz-layout">
            <BusinessPicker value={picked} onPick={setPicked} onActivate={() => picked !== main && setConfirming(true)} />
            <BusinessPreview type={picked}>
              {confirming ? (
                <div className="biz-confirm" role="alertdialog" aria-labelledby="biz-confirm-title" aria-describedby="biz-confirm-text">
                  <strong id="biz-confirm-title">{t('bc_confirmTitle', { t: t(titleKey(picked)) })}</strong>
                  <p id="biz-confirm-text">{t('bc_confirmText', { o: t(titleKey(main)) })}</p>
                  <div className="actions">
                    <button type="button" className="btn" onClick={() => setConfirming(false)}>{t('cancel')}</button>
                    <button type="button" className="btn primary" disabled={saving} onClick={() => void changeMain()}>{t('bc_confirmYes')}</button>
                  </div>
                </div>
              ) : (
                <div className="actions">
                  <button type="button" className="btn" onClick={() => setChanging(false)}>{t('cancel')}</button>
                  <button type="button" className="btn primary" disabled={picked === main} onClick={() => setConfirming(true)}>{t('bc_useThis')}</button>
                </div>
              )}
            </BusinessPreview>
          </div>
        )}
      </section>

      <section className="stack biz-also" aria-labelledby="biz-also">
        <label className="biz-switch">
          <input type="checkbox" role="switch" checked={alsoOn} onChange={(e) => setAlsoOn(e.target.checked)} />
          <span className="biz-switch-track" aria-hidden="true" />
          <span>
            <strong id="biz-also">{t('bc_alsoTitle')}</strong>
            <span className="muted small">{t('bc_alsoText')}</span>
          </span>
        </label>
        {alsoOn && (
          <>
            <div className="biz-minis" role="group" aria-labelledby="biz-also">
              {BUSINESS_CARDS.filter((c) => c.type !== main).map((c) => {
                const on = extras.includes(c.type);
                return (
                  <button key={c.type} type="button" className={'biz-mini' + (on ? ' on' : '')} aria-pressed={on} disabled={!on && blocked(c.type)} onClick={() => toggle(c.type)}>
                    <BusinessArt type={c.type} group={c.group} size={32} />
                    <span>{t(titleKey(c.type))}</span>
                  </button>
                );
              })}
            </div>
            <p className="muted small">{many ? t('bc_alsoMany') : t('bc_alsoMax')}</p>
          </>
        )}
        {!alsoOn && now.extras.length > 0 && <p className="muted small">{t('bc_alsoOffNote')}</p>}
        {extrasDirty && (
          <div className="actions">
            <button type="button" className="btn primary" disabled={saving} onClick={() => void run(() => saveBusinessChoice(settings, main, chosenExtras))}>{t('save')}</button>
          </div>
        )}
      </section>

      <ErrorBox error={error} />
      {/* categories and brands for the trade: only when pressed, never by themselves */}
      <fieldset className="card pad stack" style={{ gap: 6 }}>
        <legend className="small"><strong>{t('cat_title')} · {t('bnd_title')}</strong></legend>
        <StarterListButton key={starterTradeFor([main, ...now.extras])} trade={starterTradeFor([main, ...now.extras])} />
      </fieldset>
    </div>
  );
}
