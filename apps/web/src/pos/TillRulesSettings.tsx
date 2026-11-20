import { useEffect, useState } from 'react';
import { ROUNDING_STEPS, type CashRounding } from '@qasa/core';
import { api, type ItemView, type UserView } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { tillsApi } from '../industry/pos-api.ts';
import { tillRulesApi, type DisplayRules, type SupervisorRules, type TillRulesView } from './rules-api.ts';
import { BAUDS, DEFAULT_SCALE, hexBytes, readScaleSettings, readWeight, serialHere, validPattern, writeScaleSettings, type ScaleSettings } from './scale.ts';
import { MAX_PICTURE_FILE_BYTES, preparePicture } from '../industry/ItemImage.tsx';

/**
 * Settings → Tills and till rules (2.0; its own section since 2.0.0): the till's rules an admin sets for every till (dinar rounding, a blind
 * close, what needs a supervisor's PIN, the open-price item, the customer screen with its pictures and pairing, gift
 * vouchers), a supervisor's own PIN, and this PC's weighing scale. Every rule starts off.
 */
export function TillRulesSettings({ admin }: { admin: boolean }) {
  const { data: rules, reload } = useLoad(() => tillRulesApi.rules().catch(() => null), []);
  if (!rules) return null;
  return (
    <>
      {admin && rules.pinAlert && <PinAlert alert={rules.pinAlert} onCleared={reload} />}
      {admin && <RulesCard rules={rules} onSaved={reload} />}
      {admin && <ScreenCard />}
      {admin && <VouchersCard />}
      {rules.mayApprove && <PinCard has={rules.hasPin} short={!!rules.pinShort} onSaved={reload} />}
      <ScaleCard />
    </>
  );
}

function RulesCard({ rules, onSaved }: { rules: TillRulesView; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [rounding, setRounding] = useState<CashRounding>(rules.rounding);
  const [roundingAccount, setRoundingAccount] = useState('');
  const [blind, setBlind] = useState(rules.blindClose);
  const [sup, setSup] = useState<SupervisorRules>(rules.supervisor);
  const [miscItem, setMiscItem] = useState(rules.misc.itemId ?? '');
  const [miscMax, setMiscMax] = useState<number | null>(rules.misc.max || null);
  const [miscUsers, setMiscUsers] = useState<string[] | null>(null);
  const [display, setDisplay] = useState<DisplayRules>(rules.display);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data: items } = useLoad(() => api.items({ active: 'true' }).catch(() => [] as ItemView[]), []);
  const { data: users } = useLoad(() => api.users().catch(() => [] as UserView[]), []);
  const services = (items ?? []).filter((it) => !it.trackStock);
  const cashiers = (users ?? []).filter((u) => u.active && (u.roles.includes('pos') || u.roles.includes('admin')));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await tillRulesApi.save({
        rounding, roundingAccount: roundingAccount || null, blindClose: blind, supervisor: sup, display,
        misc: { itemId: miscItem || null, max: miscItem ? miscMax ?? 0 : 0, users: miscUsers }
      });
      toast(t('tu_rulesSaved'));
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const flag = (key: Exclude<keyof SupervisorRules, 'discountPct'>) => (
    <label key={key} className="row" style={{ gap: 6 }}>
      <input type="checkbox" checked={sup[key]} onChange={(e) => setSup({ ...sup, [key]: e.target.checked })} />
      {t(`tu_act_${({ lineDelete: 'line_delete', void: 'void', price: 'price', noSale: 'no_sale', refund: 'refund', creditOver: 'credit_over' } as const)[key]}`)}
    </label>
  );
  return (
    <div className="settings-group" data-setting="pos-rules">
      <div className="setting">
        <Icon name="key" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tu_rules')}</strong><span>{t('tu_rulesHelp')}</span></div>
        <div className="setting-ctl stack" style={{ gap: 12 }}>
          <fieldset className="stack" style={{ gap: 6 }}>
            <legend><strong>{t('tu_rounding')}</strong> <span className="small muted">{t('tu_roundHelp')}</span></legend>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field"><span>{t('tu_roundTo')}</span>
                <select className="input" value={rounding.step} onChange={(e) => setRounding({ ...rounding, step: Number(e.target.value) as CashRounding['step'] })}>
                  {ROUNDING_STEPS.map((s) => <option key={s} value={s}>{s ? i18n.money(s, 'IQD') : t('tu_roundNone')}</option>)}
                </select>
              </label>
              {rounding.step > 0 && (
                <label className="field"><span>{t('tu_roundMode')}</span>
                  <select className="input" value={rounding.mode} onChange={(e) => setRounding({ ...rounding, mode: e.target.value as CashRounding['mode'] })}>
                    {(['nearest', 'up', 'down'] as const).map((m) => <option key={m} value={m}>{t(`tu_mode_${m}`)}</option>)}
                  </select>
                </label>
              )}
              {rounding.step > 0 && (
                <div className="field"><span>{t('tu_roundAccount')}</span>
                  <AccountCombo value={roundingAccount} onChange={setRoundingAccount} filter={(a) => /^[34]/.test(a.code)} ariaLabel={t('tu_roundAccount')} />
                  <span className="small muted">{t('tu_roundAccountDefault')}</span>
                </div>
              )}
            </div>
          </fieldset>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
            <span><strong>{t('tu_blind')}</strong><div className="small muted">{t('tu_blindHelp')}</div></span>
          </label>
          <fieldset className="stack" style={{ gap: 6 }}>
            <legend><strong>{t('tu_supTitle')}</strong> <span className="small muted">{t('tu_supHelp')}</span></legend>
            <div className="grid-2">
              {(['lineDelete', 'void', 'price', 'noSale', 'refund', 'creditOver'] as const).map(flag)}
            </div>
            <label className="field" style={{ maxInlineSize: 220 }}><span>{t('tu_supDiscount')}</span>
              <input className="input num ltr" type="number" min={0} max={100} value={sup.discountPct || ''} placeholder="0"
                onChange={(e) => setSup({ ...sup, discountPct: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} />
            </label>
          </fieldset>
          <fieldset className="stack" style={{ gap: 6 }}>
            <legend><strong>{t('tu_miscTitle')}</strong></legend>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field"><span>{t('tu_miscItem')}</span>
                <select className="input" value={miscItem} onChange={(e) => setMiscItem(e.target.value)}>
                  <option value="">{t('tu_miscOff')}</option>
                  {services.map((it) => <option key={it.id} value={it.id}>{it.code} — {i18n.name(it.name)}</option>)}
                </select>
              </label>
              {miscItem && <label className="field"><span>{t('tu_miscMaxLabel')}</span><AmountInput value={miscMax} currency="IQD" onChange={setMiscMax} ariaLabel={t('tu_miscMaxLabel')} /></label>}
            </div>
            {miscItem && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="small">{t('tu_miscWho')}</span>
                <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={miscUsers === null} onChange={(e) => setMiscUsers(e.target.checked ? null : [])} />{t('tu_miscEveryone')}</label>
                {miscUsers !== null && cashiers.map((u) => (
                  <label key={u.id} className="row" style={{ gap: 6 }}>
                    <input type="checkbox" checked={miscUsers.includes(u.id)} onChange={(e) => setMiscUsers(e.target.checked ? [...miscUsers, u.id] : miscUsers.filter((x) => x !== u.id))} />{u.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="stack" style={{ gap: 6 }}>
            <legend><strong>{t('tu_displayTitle')}</strong></legend>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field"><span>{t('tu_displayLang')}</span>
                <select className="input" value={display.lang} onChange={(e) => setDisplay({ ...display, lang: e.target.value as DisplayRules['lang'] })}>
                  <option value="till">{t('tu_langTill')}</option>
                  <option value="ar">العربية</option>
                  <option value="ku">کوردی</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="field" style={{ flex: 1, minInlineSize: 220 }}><span>{t('tu_payText')}</span>
                <input className="input" maxLength={200} value={display.paymentText} onChange={(e) => setDisplay({ ...display, paymentText: e.target.value.replace(/[<>]/g, '') })} />
              </label>
            </div>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={display.slideshow} onChange={(e) => setDisplay({ ...display, slideshow: e.target.checked })} />{t('tu_slideshow')}</label>
          </fieldset>
          <ErrorBox error={error} />
          <div><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('tu_saveRules')}</button></div>
        </div>
      </div>
    </div>
  );
}

/** The customer screen's pictures (shown while idle) and the pairing code of each till for a screen on another device. */
function ScreenCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, reload } = useLoad(() => tillRulesApi.images(), []);
  const { data: tills } = useLoad(() => tillsApi.list().then((r) => r.tills.filter((x) => x.active)).catch(() => []), []);
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    for (const img of data?.images ?? []) {
      if (pictures[img.id]) continue;
      void tillRulesApi.adminImage(img.id).then((x) => setPictures((p) => ({ ...p, [img.id]: `data:${x.mime};base64,${x.data}` })), () => {});
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (file: File) => {
    setError(null);
    try {
      // a phone photo (3 MB and more) is made small in the browser first, as item pictures are: a customer screen needs
      // no more than 1280 px, and the server takes up to 400 KB
      const picture = await preparePicture(file, { maxSide: 1280, targetBytes: 380 * 1024 });
      if ('refused' in picture) { toast(picture.refused === 'too_big' ? t('it_pictureTooBig', { n: MAX_PICTURE_FILE_BYTES / (1024 * 1024) }) : t('md_imageUnreadable')); return; }
      await tillRulesApi.addImage(picture.data);
      reload();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="settings-group" data-setting="pos-screen">
      <div className="setting">
        <Icon name="panel" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tu_pictures')}</strong><span>{t('tu_slideshow')}</span></div>
        <div className="setting-ctl stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(data?.images ?? []).map((img) => (
              <span key={img.id} className="pos-pic-thumb">
                {pictures[img.id] && <img src={pictures[img.id]} alt="" />}
                <button type="button" className="btn small" aria-label={t('pos_remove')} onClick={() => void tillRulesApi.deleteImage(img.id).then(reload, setError)}><Icon name="x" size={14} /></button>
              </span>
            ))}
          </div>
          {(data?.images.length ?? 0) < (data?.max ?? 12) && (
            <label className="btn small" style={{ alignSelf: 'flex-start' }}><Icon name="upload" size={14} />{t('tu_addPicture')}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            </label>
          )}
          <strong className="small">{t('tu_pairTitle')}</strong>
          <span className="small muted">{t('tu_pairHelp')}</span>
          {(tills ?? []).map((x) => (
            <div key={x.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span>{x.name}</span>
              {codes[x.id] && <strong className="num ltr pos-pair-code">{codes[x.id]}</strong>}
              <button type="button" className="btn small" onClick={() => void tillRulesApi.displayCode(x.id).then((r) => { setCodes((c) => ({ ...c, [x.id]: r.code })); toast(r.code); }, setError)}>
                <Icon name="key" size={14} />{t('tu_pairMake')}
              </button>
            </div>
          ))}
          <ErrorBox error={error} />
        </div>
      </div>
    </div>
  );
}

/** Gift vouchers: sold, used, still owed, and an unused one cancelled (refunded) by an admin. */
function VouchersCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, reload } = useLoad(() => tillRulesApi.vouchers().catch(() => null), []);
  const [error, setError] = useState<unknown>(null);
  if (!data) return null;
  return (
    <div className="settings-group" data-setting="pos-vouchers">
      <div className="setting">
        <Icon name="tag" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tu_gvReport')}</strong></div>
        <div className="setting-ctl stack" style={{ gap: 8 }}>
          <div className="grid-2 small">
            <span>{t('tu_gvSoldTotal')}: <strong className="num">{i18n.money(data.sold, 'IQD')}</strong></span>
            <span>{t('tu_gvUsedTotal')}: <strong className="num">{i18n.money(data.used, 'IQD')}</strong></span>
            <span>{t('tu_gvOutstanding')}: <strong className="num">{i18n.money(data.outstanding, 'IQD')}</strong></span>
            <span>{t('tu_gvExpired')}: <strong className="num">{i18n.money(data.expiredUnused, 'IQD')}</strong></span>
          </div>
          {data.expiredUnused > 0 && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn small" onClick={() => void tillRulesApi.expireVouchers().then((r) => { if (r.entryId) location.hash = href(`entry/${r.entryId}`); reload(); }, setError)}>{t('tu_gvWriteOff')}</button>
              <span className="small muted">{t('tu_gvWriteOffHint')}</span>
            </div>
          )}
          {data.vouchers.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {data.vouchers.slice(0, 50).map((v) => (
                    <tr key={v.id}>
                      <td className="ltr num">{v.code}</td>
                      <td className="num">{i18n.money(v.amount, 'IQD')}</td>
                      <td className="num">{i18n.money(v.balance, 'IQD')}</td>
                      <td className="small">{v.expiresOn ? i18n.date(v.expiresOn) : '—'}</td>
                      <td>{v.status === 'cancelled' ? <span className="chip">{t('pos_cancelled')}</span>
                        : v.balance === v.amount ? <button type="button" className="btn small" onClick={() => void tillRulesApi.cancelVoucher(v.id).then(reload, setError)}>{t('tu_gvCancel')}</button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ErrorBox error={error} />
        </div>
      </div>
    </div>
  );
}

/** Wrong PINs locked approvals at a till: an admin sees it here until they clear it. */
function PinAlert({ alert, onCleared }: { alert: NonNullable<TillRulesView['pinAlert']>; onCleared(): void }) {
  const { t, dateTime } = useI18n();
  return (
    <div className="alert warn row" role="alert" data-setting="pos-pin-alert" style={{ gap: 10, marginBottom: 14 }}>
      <Icon name="key" size={18} />
      <span>{t(alert.scope === 'all' ? 'tu_pinAlertAll' : 'tu_pinAlert', { name: alert.cashier, n: alert.tries, at: dateTime(alert.at) })}</span>
      <button type="button" className="btn btn-sm" onClick={() => void tillRulesApi.clearPinAlert().then(onCleared)}>{t('tu_pinAlertSeen')}</button>
    </div>
  );
}

/** A supervisor's own PIN (an admin is a supervisor too). */
function PinCard({ has, short, onSaved }: { has: boolean; short: boolean; onSaved(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="settings-group" data-setting="pos-pin">
      <div className="setting">
        <Icon name="key" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tu_myPin')}</strong><span>{t('tu_pinRule')}</span>{has && !short && <span className="small muted">✓</span>}{short && <span className="chip warn">{t('tu_pinShort')}</span>}</div>
        <form className="setting-ctl row" style={{ gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          void tillRulesApi.setPin(pin).then(() => { setPin(''); setError(null); toast(t('tu_pinSaved')); onSaved(); }, setError);
        }}>
          <input className="input num ltr" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label={t('tu_myPin')} />
          <button type="submit" className="btn" disabled={!/^\d{6,8}$/.test(pin)}>{t('tu_setPin')}</button>
          <ErrorBox error={error} />
        </form>
      </div>
    </div>
  );
}

/** This PC's weighing scale (kept on the PC: the scale plugged into it). */
function ScaleCard() {
  const { t, qty } = useI18n();
  const [s, setS] = useState<ScaleSettings>(readScaleSettings);
  const [said, setSaid] = useState('');
  const here = serialHere();
  const save = (next: ScaleSettings) => { setS(next); writeScaleSettings(next); };
  return (
    <div className="settings-group" data-setting="pos-scale">
      <div className="setting">
        <Icon name="scale" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tu_scaleTitle')}</strong><span>{t('tu_scaleHelp')}</span>{!here && <span className="small muted">{t('tu_scaleNotHere')}</span>}</div>
        <div className="setting-ctl stack" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={s.on} disabled={!here} onChange={(e) => save({ ...s, on: e.target.checked })} />{t('tu_scaleOn')}</label>
          {s.on && (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="field"><span>{t('tu_scaleBaud')}</span>
                  <select className="input" value={s.baud} onChange={(e) => save({ ...s, baud: Number(e.target.value) })}>{BAUDS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
                </label>
                <label className="field"><span>{t('tu_scaleUnit')}</span>
                  <select className="input" value={s.unit} onChange={(e) => save({ ...s, unit: e.target.value === 'g' ? 'g' : 'kg' })}><option value="kg">kg</option><option value="g">g</option></select>
                </label>
                <label className="field"><span>{t('tu_scaleRequest')}</span>
                  <input className="input ltr" maxLength={48} value={s.request} placeholder="05" aria-invalid={hexBytes(s.request) === null} onChange={(e) => setS({ ...s, request: e.target.value })} onBlur={() => { if (hexBytes(s.request)) save(s); }} />
                </label>
              </div>
              <label className="field"><span>{t('tu_scalePattern')}</span>
                <input className="input ltr" maxLength={200} value={s.pattern} aria-invalid={!validPattern(s.pattern)} onChange={(e) => setS({ ...s, pattern: e.target.value })} onBlur={() => save(validPattern(s.pattern) ? s : { ...s, pattern: DEFAULT_SCALE.pattern })} />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn small" onClick={() => void readWeight(s).then((kg) => setSaid(kg === null ? t('tu_scaleNone') : t('tu_scaleGot', { n: `${qty(Math.round(kg * 1000))} kg` })), () => setSaid(t('tu_scaleNone')))}>{t('tu_scaleTest')}</button>
                {said && <span className="small" role="status">{said}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
