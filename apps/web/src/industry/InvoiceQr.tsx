import { useEffect, useMemo, useState } from 'react';
import { request } from '../api.ts';
import { useI18n } from '../i18n.ts';
import { encodeQr, qrSvgPath } from './qr.ts';

export interface InvoiceQrAnswer { url: string; licensed: boolean }

/**
 * The QR code printed on a posted sale invoice: the customer scans it with any phone camera and qasaerp.com/v/
 * shows the invoice's number, date and total, and — for companies on a paid plan — who issued it and that nothing
 * was changed. Shows nothing while loading or when the invoice can't have one.
 */
export function InvoiceQr({ invoiceId, size = 96 }: { invoiceId: string; size?: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [answer, setAnswer] = useState<InvoiceQrAnswer | null>(null);
  useEffect(() => {
    let live = true;
    request<InvoiceQrAnswer>('GET', `/api/verify/invoices/${encodeURIComponent(invoiceId)}?lang=${i18n.lang}`)
      .then((a) => { if (live) setAnswer(a); })
      .catch(() => { if (live) setAnswer(null); });
    return () => { live = false; };
  }, [invoiceId, i18n.lang]);
  const qr = useMemo(() => (answer ? qrSvgPath(encodeQr(answer.url, 'M'), 2) : null), [answer]);
  if (!answer || !qr) return null;
  return (
    <div className="invoice-qr" style={{ display: 'flex', alignItems: 'center', gap: 10, breakInside: 'avoid' }}>
      <svg
        role="img" aria-label={t('vf_qrLabel')} width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`}
        shapeRendering="crispEdges" style={{ flexShrink: 0, background: '#fff' }}
      >
        <path d={qr.path} fill="#000" />
      </svg>
      <div className="small muted" style={{ maxWidth: 220, lineHeight: 1.45 }}>
        {t(answer.licensed ? 'vf_scanVerified' : 'vf_scanDetails')}
      </div>
    </div>
  );
}
