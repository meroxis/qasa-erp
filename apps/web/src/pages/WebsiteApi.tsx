import { useState, type FormEvent } from 'react';
import { todayIso } from '@qasa/core';
import { ErrorBox, Icon, Modal, useLoad, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { webApiClient, type NetworkForWeb, type WebEvent, type WebScope } from '../industry/webapi-api.ts';

const SCOPE_KEYS: Record<WebScope, Key> = {
  'items:read': 'wa_scope_items', 'stock:read': 'wa_scope_stock', 'customers:write': 'wa_scope_customers', 'orders:write': 'wa_scope_orders'
};
const EVENT_KEYS: Record<WebEvent, Key> = { 'stock.changed': 'wa_event_stock', 'price.changed': 'wa_event_price', 'order.updated': 'wa_event_order' };

/** A secret shown once, with a copy button. */
function OnceSecret({ label, value, onClose }: { label: string; value: string; onClose(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Modal title={label} onClose={onClose}>
      <div className="stack">
        <div className="alert warn">{t('wa_shownOnce')}</div>
        <code className="ltr" style={{ wordBreak: 'break-all', padding: 12, background: 'var(--surface-2, var(--bg))', borderRadius: 8 }}>{value}</code>
        <div className="actions">
          <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(value); toast(t('wa_copied')); }}>
            <Icon name="doc" size={16} />{t('wa_copy')}
          </button>
          <button type="button" className="btn primary" onClick={onClose}>{t('wa_done')}</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * How a website reaches this office. Over the internet (Qasa Relay): the office ID and the office key it seals each
 * request for (public, so shown in full with a copy button). On the office network: the address and the certificate
 * code it pins. The API key itself is shown once, when it is made. An admin can make a new office key (onRenewKey) when
 * the old one may have been seen by someone else; the page also says when it had to be made again on its own.
 */
export function ConnectCard({ net, onRenewKey, busy = false }: { net: NetworkForWeb | null; onRenewKey?: () => void; busy?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const value = { margin: 0, fontWeight: 600, wordBreak: 'break-all' } as const;
  const relay = net?.relay ?? null;
  return (
    <div className="card pad stack">
      <h2>{t('wa_connectTitle')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('wa_connectHelp')}</p>
      {net?.on ? (
        <>
          <h3 style={{ margin: 0 }}>{t('wa_viaRelay')}</h3>
          {relay ? (
            <dl className="grid-2" style={{ margin: 0 }}>
              <div><dt className="muted small">{t('wa_officeId')}</dt><dd className="ltr" style={value}>{relay.officeIdShown ?? relay.officeId}</dd></div>
              <div>
                <dt className="muted small">{t('wa_officeKey')}</dt>
                <dd className="ltr row" style={{ ...value, gap: 6 }}>
                  <code>{relay.officeKey ?? '—'}</code>
                  {relay.officeKey && (
                    <button type="button" className="btn small" onClick={() => { void navigator.clipboard?.writeText(relay.officeKey!); toast(t('wa_copied')); }}>
                      <Icon name="doc" size={14} />{t('wa_copy')}
                    </button>
                  )}
                </dd>
                <dd className="muted small" style={{ margin: 0 }}>{t('wa_officeKeyHelp')}</dd>
                {relay.officeKey && onRenewKey && (
                  <dd style={{ margin: '6px 0 0' }}>
                    <button type="button" className="btn small" disabled={busy}
                      onClick={() => { if (window.confirm(t('wa_renewOfficeKeyConfirm'))) onRenewKey(); }}>
                      {t('wa_renewOfficeKey')}
                    </button>
                  </dd>
                )}
              </div>
            </dl>
          ) : (
            <div className="alert info">{t('wa_relayOff')}</div>
          )}
          {relay?.officeKeyRemadeAt && (
            <div className="alert warn">{t('wa_officeKeyRemade', { d: i18n.date(todayIso(new Date(relay.officeKeyRemadeAt))) })}</div>
          )}
          <h3 style={{ margin: 0 }}>{t('wa_onLan')}</h3>
          <dl className="grid-2" style={{ margin: 0 }}>
            <div><dt className="muted small">{t('wa_lanAddress')}</dt><dd className="ltr" style={{ margin: 0 }}>{net.addresses.map((a) => `https://${a}:${net.port}`).join('  ·  ') || '—'}</dd></div>
            <div><dt className="muted small">{t('wa_pinCode')}</dt><dd className="ltr" style={value}>{net.code ?? '—'}</dd></div>
          </dl>
        </>
      ) : (
        <div className="alert info">{t('wa_networkOff')} <a href={href('settings')}>{t('settings')}</a></div>
      )}
    </div>
  );
}

/**
 * Settings → Website API (Pro): the keys an online shop or a website uses, what each may do, and the webhooks that
 * tell the site about changes. Also how a site reaches this office (ConnectCard).
 */
export function WebsiteApi() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, error, reload } = useLoad(() => webApiClient.overview(), []);
  const net = useLoad(() => webApiClient.network().catch(() => null), []);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [newKey, setNewKey] = useState<{ name: string; scopes: WebScope[] } | null>(null);
  const [newHook, setNewHook] = useState<{ url: string; events: WebEvent[] } | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      if (done) toast(done);
      reload();
      return true;
    } catch (e) {
      setActionError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveKey(e: FormEvent) {
    e.preventDefault();
    if (!newKey) return;
    await run(async () => {
      const made = await webApiClient.createKey({ name: newKey.name.trim(), scopes: newKey.scopes });
      setNewKey(null);
      setSecret({ label: t('wa_keyMade'), value: made.key });
    });
  }

  async function saveHook(e: FormEvent) {
    e.preventDefault();
    if (!newHook) return;
    await run(async () => {
      const made = await webApiClient.createWebhook({ url: newHook.url.trim(), events: newHook.events });
      setNewHook(null);
      setSecret({ label: t('wa_hookMade'), value: made.secret });
    });
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const n = net.data;
  const date = (iso: string | null) => (iso ? i18n.date(todayIso(new Date(iso))) : '—');

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="card pad stack">
        <div className="row">
          <h2>{t('wa_title')}</h2>
          {!data.available && <a className="chip plan-pro" href={href('plans')}>Pro</a>}
        </div>
        <p className="muted" style={{ margin: 0 }}>{t('wa_intro')}</p>
        {!data.available && <div className="alert info">{t('wa_needsPro')}</div>}
      </div>

      <ConnectCard
        net={n ?? null} busy={busy}
        onRenewKey={() => void run(async () => { await webApiClient.renewOfficeKey(); net.reload(); }, t('wa_officeKeyRenewed'))}
      />

      <div className="card">
        <div className="row" style={{ padding: '14px 16px 8px' }}>
          <h2>{t('wa_keys')}</h2>
          <span className="spacer" />
          <button type="button" className="btn primary" disabled={!data.available || busy} onClick={() => setNewKey({ name: '', scopes: ['items:read', 'stock:read', 'orders:write', 'customers:write'] })}>
            <Icon name="plus" size={16} />{t('wa_newKey')}
          </button>
        </div>
        {data.keys.length ? (
          <table className="table">
            <thead><tr><th>{t('name')}</th><th>{t('wa_key')}</th><th>{t('wa_scopes')}</th><th>{t('wa_lastUsed')}</th><th>{t('colStatus')}</th><th /></tr></thead>
            <tbody>
              {data.keys.map((k) => (
                <tr key={k.id}>
                  <td><strong>{k.name}</strong><div className="muted small">{k.createdBy} · {date(k.createdAt)}</div></td>
                  <td className="ltr" style={{ textAlign: 'start' }}><code>{k.prefix}…</code></td>
                  <td>{k.scopes.map((s) => <span key={s} className="chip" style={{ marginInlineEnd: 4 }}>{t(SCOPE_KEYS[s])}</span>)}</td>
                  <td className="num">{date(k.lastUsedAt)}</td>
                  <td>{k.revokedAt ? <span className="chip bad">{t('wa_revoked')}</span> : <span className="chip ok">{t('wa_active')}</span>}</td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    {!k.revokedAt && (
                      <button type="button" className="btn small" disabled={busy}
                        onClick={() => { if (window.confirm(t('wa_revokeConfirm', { n: k.name }))) void run(() => webApiClient.revokeKey(k.id), t('wa_revoked')); }}>
                        {t('wa_revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ padding: '0 16px 16px', margin: 0 }}>{t('wa_noKeys')}</p>}
      </div>

      <div className="card">
        <div className="row" style={{ padding: '14px 16px 8px' }}>
          <h2>{t('wa_webhooks')}</h2>
          <span className="spacer" />
          <button type="button" className="btn" disabled={!data.available || busy} onClick={() => setNewHook({ url: 'https://', events: ['stock.changed', 'price.changed', 'order.updated'] })}>
            <Icon name="plus" size={16} />{t('wa_newHook')}
          </button>
        </div>
        <p className="muted small" style={{ padding: '0 16px', margin: 0 }}>{t('wa_hooksHelp')}</p>
        {data.webhooks.length ? (
          <table className="table">
            <thead><tr><th>{t('wa_url')}</th><th>{t('wa_events')}</th><th>{t('wa_lastDelivery')}</th><th /></tr></thead>
            <tbody>
              {data.webhooks.map((h) => (
                <tr key={h.id}>
                  <td className="ltr" style={{ textAlign: 'start', wordBreak: 'break-all' }}>{h.url}{!h.active && <span className="chip warn" style={{ marginInlineStart: 6 }}>{t('wa_paused')}</span>}</td>
                  <td>{h.events.map((e) => <span key={e} className="chip" style={{ marginInlineEnd: 4 }}>{t(EVENT_KEYS[e])}</span>)}</td>
                  <td>
                    {h.lastStatus === null ? '—' : (
                      <span className={'chip ' + (h.lastStatus >= 200 && h.lastStatus < 300 ? 'ok' : 'bad')}>{h.lastStatus || t('wa_unreachable')}</span>
                    )}
                    <div className="muted small">{date(h.lastDeliveryAt)}</div>
                  </td>
                  <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn small" disabled={busy}
                      onClick={() => void run(async () => { const r = await webApiClient.testWebhook(h.id); toast(t('wa_testResult', { s: r.status || t('wa_unreachable') })); })}>
                      {t('wa_test')}
                    </button>
                    <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => webApiClient.updateWebhook(h.id, { active: !h.active }), t('saved'))}>
                      {h.active ? t('wa_pause') : t('wa_resume')}
                    </button>
                    <button type="button" className="btn small danger" disabled={busy}
                      onClick={() => { if (window.confirm(t('wa_deleteHookConfirm'))) void run(() => webApiClient.deleteWebhook(h.id), t('wa_deleted')); }}>
                      {t('wa_delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ padding: '8px 16px 16px', margin: 0 }}>{t('wa_noHooks')}</p>}
      </div>

      <div className="card pad stack">
        <h2>{t('wa_shopsTitle')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('wa_shopsHelp')}</p>
      </div>

      <ErrorBox error={actionError} />

      {newKey && (
        <Modal title={t('wa_newKey')} onClose={() => setNewKey(null)}>
          <form className="stack" onSubmit={saveKey}>
            <label className="field"><span>{t('wa_keyName')}</span>
              <input className="input" autoFocus value={newKey.name} placeholder={t('wa_keyNameHint')} onChange={(e) => setNewKey({ ...newKey, name: e.target.value })} maxLength={100} />
            </label>
            <fieldset className="role-list">
              <legend>{t('wa_scopes')}</legend>
              {data.scopes.map((s) => (
                <label key={s} className="role-option">
                  <input type="checkbox" checked={newKey.scopes.includes(s)}
                    onChange={() => setNewKey({ ...newKey, scopes: newKey.scopes.includes(s) ? newKey.scopes.filter((x) => x !== s) : [...newKey.scopes, s] })} />
                  <span><strong>{t(SCOPE_KEYS[s])}</strong><span className="muted small"> — {t(`${SCOPE_KEYS[s]}Help` as Key)}</span></span>
                </label>
              ))}
            </fieldset>
            <ErrorBox error={actionError} />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setNewKey(null)}>{t('cancel')}</button>
              <button type="submit" className="btn primary" disabled={busy || !newKey.name.trim() || !newKey.scopes.length}>{t('wa_make')}</button>
            </div>
          </form>
        </Modal>
      )}

      {newHook && (
        <Modal title={t('wa_newHook')} onClose={() => setNewHook(null)}>
          <form className="stack" onSubmit={saveHook}>
            <label className="field"><span>{t('wa_url')}</span>
              <input className="input ltr" autoFocus type="url" value={newHook.url} onChange={(e) => setNewHook({ ...newHook, url: e.target.value })} maxLength={500} />
            </label>
            <fieldset className="role-list">
              <legend>{t('wa_events')}</legend>
              {data.events.map((ev) => (
                <label key={ev} className="role-option">
                  <input type="checkbox" checked={newHook.events.includes(ev)}
                    onChange={() => setNewHook({ ...newHook, events: newHook.events.includes(ev) ? newHook.events.filter((x) => x !== ev) : [...newHook.events, ev] })} />
                  <span><strong>{t(EVENT_KEYS[ev])}</strong></span>
                </label>
              ))}
            </fieldset>
            <ErrorBox error={actionError} />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setNewHook(null)}>{t('cancel')}</button>
              <button type="submit" className="btn primary" disabled={busy || !newHook.events.length || newHook.url.length < 10}>{t('wa_make')}</button>
            </div>
          </form>
        </Modal>
      )}

      {secret && <OnceSecret label={secret.label} value={secret.value} onClose={() => setSecret(null)} />}
    </div>
  );
}
