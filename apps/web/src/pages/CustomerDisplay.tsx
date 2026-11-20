import { useEffect, useState } from 'react';
import { CUSTOMER_CHANNEL, type CustomerScreenState } from '../industry/till.ts';

/**
 * The customer screen (2.0): a second window of the app's own page, facing the customer. It shows only what the till
 * in this browser sends it (the lines, the total, what was paid and the change), already in the till's language. It
 * reads nothing from the server and has no buttons.
 */
export function CustomerDisplay() {
  const [state, setState] = useState<CustomerScreenState | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CUSTOMER_CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const s = e.data as CustomerScreenState | null;
      if (s && typeof s === 'object' && Array.isArray(s.lines)) setState(s);
    };
    return () => channel.close();
  }, []);
  useEffect(() => {
    if (!state) return;
    document.documentElement.dir = state.dir;
    document.documentElement.lang = state.lang;
  }, [state?.dir, state?.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return <div className="cd cd-idle"><div className="cd-welcome">…</div></div>;
  const empty = state.lines.length === 0;
  return (
    <div className="cd" dir={state.dir}>
      <header className="cd-head">{state.company}</header>
      {empty && !state.done ? (
        <div className="cd-welcome">{state.welcome}</div>
      ) : (
        <>
          <div className="cd-lines">
            {state.lines.slice(-12).map((l, i) => (
              <div key={i} className="cd-line"><span className="cd-name">{l.name}</span><span className="num cd-qty">{l.qty}</span><span className="num cd-amount">{l.amount}</span></div>
            ))}
          </div>
          <div className="cd-total"><span>{state.totalLabel}</span><strong className="num">{state.total}</strong></div>
          {state.paid && <div className="cd-row"><span>{state.paid.label}</span><span className="num">{state.paid.value}</span></div>}
          {state.change && <div className="cd-row cd-change"><span>{state.change.label}</span><strong className="num">{state.change.value}</strong></div>}
          {state.done && <div className="cd-done">{state.done}</div>}
        </>
      )}
    </div>
  );
}
