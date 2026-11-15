import { useState } from 'react';
import { Image, View } from 'react-native';
import { dateText, money, nameIn } from '../../i18n';
import type { EntrySummary } from '../../owner/api';
import {
  ActionKeys, approvalTabs, buttonsFor, kindKey, MAX_REASON, photoToShow, reasonOk, sendAction, toCheck, waitingSections, type ApprovalButton, type ApprovalTab
} from '../../owner/approvals';
import { radius, space } from '../../theme';
import { Banner, Button, Card, EmptyState, ErrorState, Field, Group, ListItem, Screen, Section, Segmented, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import { confirm } from '../items';

/**
 * Approvals (phone app 1.1): what waits for this user, as on the desktop. An approver sees the vouchers sent for approval
 * and the entries checked and waiting to be approved; someone who checks sees the drafts to check. The office's own rules
 * decide every action again; reading works offline only as far as the link does, and acting needs the office.
 */
export function ApprovalsScreen() {
  const { t, lang } = useLook();
  const { api, go, nav, me, explain } = useApp();
  const tabs = approvalTabs(me);
  const [tab, setTab] = useState<ApprovalTab>(tabs[0] ?? 'waiting');
  const load = useLoad(async () => {
    if (tab === 'waiting') {
      const [sent, checked] = await Promise.all([api.entries('waiting'), api.entries('checked')]);
      return { tab, sent, checked, drafts: [] as EntrySummary[] };
    }
    return { tab, sent: [] as EntrySummary[], checked: [] as EntrySummary[], drafts: toCheck(await api.entries('draft')) };
  }, [tab]);
  const back = () => nav({ type: 'back' });
  const rows = (list: readonly EntrySummary[]) => (
    <Group>
      {list.map((e) => {
        const title = `${t(kindKey(e.type))} · ${e.party || e.description || e.number || t('aprDraft')}`;
        const subtitle = `${dateText(e.date)} · ${t('aprPreparedBy', { u: e.preparedBy })}`;
        const value = money(e.total, e.currency, lang);
        // a camera: the voucher has the photo of its paper receipt (said to the screen reader too)
        return (
          <ListItem key={e.id} icon={e.hasImage ? 'camera' : 'doc'} title={title} subtitle={subtitle} value={value}
            label={[title, subtitle, value, e.hasImage ? t('expPhoto') : null].filter(Boolean).join(', ')}
            onPress={() => go({ name: 'approval', id: e.id })} />
        );
      })}
    </Group>
  );
  // (the other tab's list is not shown while this one's loads)
  const d = load.data?.tab === tab ? load.data : undefined;
  const empty = d && !d.sent.length && !d.checked.length && !d.drafts.length;
  return (
    <Screen title={t('aprTitle')} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}>
      {tabs.length > 1 && (
        <Segmented<ApprovalTab> label={t('aprTitle')} value={tab} onChange={setTab}
          options={tabs.map((x) => ({ value: x, label: x === 'waiting' ? t('aprWaitingTab') : t('aprCheckTab') }))} />
      )}
      {load.loading || (!d && !load.error) ? <Skeleton rows={5} />
        : load.error || !d ? <ErrorState text={explain(load.error)} onRetry={load.reload} />
        : empty ? <EmptyState icon="check" title={t('aprNone')} />
        : tab === 'waiting' ? waitingSections(d.sent, d.checked).map((s) => <Section key={s.title} title={t(s.title)}>{rows(s.entries)}</Section>)
        : rows(d.drafts)}
    </Screen>
  );
}

/**
 * One entry: what it says, and the buttons of what this user may do with it now (the office's own list). Every action
 * goes with the entry as it was shown (`seen`): changed since, the office refuses it and the screen loads it again for
 * another look. Approving and returning ask first; a rejection needs its reason.
 */
export function ApprovalScreen({ id }: { id: string }) {
  const { t, lang } = useLook();
  const { api, nav, me, state, explain, toast } = useApp();
  const load = useLoad(() => api.entry(id), [id]);
  const [keys] = useState(() => new ActionKeys());
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ kind: 'warn' | 'bad'; text: string } | null>(null);
  const online = state === 'online';
  const back = () => nav({ type: 'back' });
  const e = load.data;

  async function act(b: ApprovalButton) {
    if (!e || busy) return;
    if (b.action === 'reject' && !reasonOk(reason)) { setMessage({ kind: 'bad', text: t('errRejectReason') }); return; }
    if (b.confirm && !(await confirm(t(b.label), t(b.confirm), t(b.label), t('cancel')))) return;
    setBusy(b.action);
    setMessage(null);
    try {
      const outcome = await sendAction(api, keys, e, b.action, reason.trim());
      if (outcome.kind === 'done') {
        toast(t(b.done), 'ok');
        back();
      } else if (outcome.kind === 'changed') {
        // changed since it was shown: look again (a new look is a new action, with a new key)
        setMessage({ kind: 'warn', text: t('aprChanged') });
        setRejecting(false);
        keys.clear();
        load.reload();
      } else if (outcome.kind === 'taken') {
        toast(t('aprTaken'));
        back();
      } else {
        // refused: why; no answer: the same action again goes with the same key
        setMessage({ kind: 'bad', text: explain(outcome.error) });
      }
    } finally {
      setBusy(null);
    }
  }

  if (load.loading) return <Screen title={t('aprTitle')} onBack={back}><Skeleton rows={1} height={140} /><Skeleton rows={4} /></Screen>;
  if (load.error || !e) return <Screen title={t('aprTitle')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;

  const { buttons, samePerson } = buttonsFor(e, me);
  const photo = photoToShow(e);
  const reject = buttons.find((b) => b.action === 'reject');
  const cash = e.cashAccountCode ? e.lines.find((l) => l.accountCode === e.cashAccountCode) : undefined;
  const footer = rejecting && reject ? (
    <>
      <Button kind="danger" icon="close" label={t('aprReject')} onPress={() => void act(reject)} busy={busy === 'reject'} disabled={!online || !reasonOk(reason)} hint={online ? undefined : t('needsOnline')} />
      <Button kind="ghost" label={t('cancel')} onPress={() => { setRejecting(false); setMessage(null); }} />
    </>
  ) : buttons.length ? (
    <>
      {!online && <Txt v="caption" tone="ink3" style={{ textAlign: 'center' }}>{t('needsOnline')}</Txt>}
      {buttons.map((b) => (
        <Button key={b.action} kind={b.kind} label={t(b.label)} busy={busy === b.action} disabled={!online || (!!busy && busy !== b.action)}
          onPress={() => (b.action === 'reject' ? setRejecting(true) : void act(b))} />
      ))}
    </>
  ) : undefined;
  return (
    <Screen title={e.number ?? t('aprDraft')} subtitle={t(kindKey(e.type))} onBack={back} onRefresh={() => { keys.clear(); load.reload(); }} refreshing={load.refreshing} footer={footer}>
      {message && <Banner kind={message.kind} text={message.text} />}
      <Card>
        <Txt v="caption" tone="ink2">{t('amount')}</Txt>
        <Txt v="numberLarge">{money(e.total, e.currency, lang)}</Txt>
        {e.currency !== 'IQD' && <Txt v="number" tone="ink2">{money(e.baseTotal, 'IQD', lang)}</Txt>}
        <Txt v="caption" tone="ink3">{dateText(e.date)}</Txt>
        {e.party ? <Txt v="bodyStrong">{e.party}</Txt> : null}
        {e.description ? <Txt tone="ink2">{e.description}</Txt> : null}
        {cash ? <Txt v="caption" tone="ink2">{`${cash.accountCode} · ${nameIn(lang, cash.accountName)}`}</Txt> : null}
      </Card>
      {samePerson && <Banner kind="info" text={t('errSamePerson')} />}
      {e.approval?.state === 'waiting' && <Txt v="caption" tone="ink2">{t('aprAskedBy', { u: e.approval.requestedBy })}</Txt>}
      {e.approval?.state === 'rejected' && e.approval.reason ? <Banner kind="warn" text={`${t('aprRejectReason')}: ${e.approval.reason}`} /> : null}
      <Txt v="caption" tone="ink2">{[t('aprPreparedBy', { u: e.preparedBy }), e.checkedBy ? t('aprCheckedBy', { u: e.checkedBy }) : null].filter(Boolean).join(' · ')}</Txt>
      {photo && <ReceiptPhoto key={photo.key} id={photo.id} by={photo.by} />}
      <Section title={t('aprAccount')}>
        <Group>
          {e.lines.map((l) => (
            <ListItem key={l.lineNo} title={`${l.accountCode} · ${nameIn(lang, l.accountName)}`} subtitle={[l.partyName, l.description].filter(Boolean).join(' · ') || undefined}
              value={`${l.debit ? t('debit') : t('credit')} ${money(l.debit || l.credit, e.currency, lang)}`} />
          ))}
        </Group>
      </Section>
      {rejecting && reject && (
        <View style={{ gap: space.s }}>
          <Txt tone="ink2">{t('aprRejectHelp')}</Txt>
          <Field label={t('aprRejectReason')} value={reason} onChangeText={setReason} maxLength={MAX_REASON} multiline autoFocus
            error={reason && !reasonOk(reason) ? t('errRejectReason') : undefined} />
        </View>
      )}
    </Screen>
  );
}

/**
 * The photo of the voucher's paper receipt, as the office keeps it (a JPEG only: anything else is not shown), decoded at
 * the size it is shown, and who added it.
 */
function ReceiptPhoto({ id, by }: { id: string; by: string }) {
  const { t, p } = useLook();
  const { api } = useApp();
  const photo = useLoad(() => api.entryImage(id), [id]);
  return (
    <Section title={t('expPhoto')}>
      <Card>
        {photo.loading ? <Skeleton rows={1} height={220} />
          : photo.data ? (
            <Image source={{ uri: photo.data }} resizeMethod="resize" resizeMode="contain" accessibilityIgnoresInvertColors accessibilityLabel={t('expPhoto')}
              style={{ width: '100%', height: 420, borderRadius: radius.m, backgroundColor: p.surface2 }} />
          ) : <Txt tone="ink3">{t('aprPhotoFailed')}</Txt>}
        {by ? <Txt v="caption" tone="ink2">{t('aprPhotoBy', { u: by })}</Txt> : null}
      </Card>
    </Section>
  );
}
