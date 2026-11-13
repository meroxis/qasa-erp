import { useRef, type KeyboardEvent } from 'react';
import { Icon } from './components.tsx';

/** One option of a ChoiceTiles group. */
export interface Choice<T extends string> {
  value: T;
  label: string;
  /** One short line under the label. */
  hint?: string;
  /** A line icon from the app's set (a sun, a moon), shown above the label. */
  icon?: string;
  /** A short sample shown above the label instead of an icon ("123", "١٢٣"). */
  sample?: string;
  /** The language of the label and the sample, when it is not the screen's (each language by its own name). */
  lang?: string;
  /** This option alone can't be chosen now. */
  disabled?: boolean;
}

/**
 * Where an arrow key, Home or End moves the focus from option `from`: to the next or the previous option that can be
 * chosen, around the ends. In Arabic and Kurdish (rtl) the left arrow goes forward, as the options are laid out.
 * Returns `from` for any other key, or when no other option can be chosen.
 */
export function choiceMove(key: string, from: number, enabled: readonly boolean[], rtl = false): number {
  const n = enabled.length;
  if (!n || !enabled.some(Boolean)) return from;
  const step = key === 'ArrowDown' || key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1
    : key === 'ArrowUp' || key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
  if (key === 'Home') return enabled.indexOf(true);
  if (key === 'End') return enabled.lastIndexOf(true);
  if (!step) return from;
  for (let i = 1; i <= n; i++) {
    const at = (((from + step * i) % n) + n) % n;
    if (enabled[at]) return at;
  }
  return from;
}

/**
 * The one option Tab stops on (the others are reached with the arrows): the chosen one, or the first that can be
 * chosen when none is, or none (-1) when the whole group is off.
 */
export function choiceTabStop(checked: number, enabled: readonly boolean[]): number {
  return checked >= 0 && enabled[checked] ? checked : enabled.indexOf(true);
}

/**
 * A setting that picks ONE of a few fixed options, as big rectangles: an icon or a sample, a label and an optional
 * hint. The chosen one has the accent border and a check mark (never colour alone). A radio group for the keyboard and
 * screen readers: Tab reaches the chosen option, the arrows (and Home, End) move between options, Space or Enter
 * chooses the one in focus.
 */
export function ChoiceTiles<T extends string>({ label, value, options, onChange, disabled = false, busy, className }: {
  /** The group's name for screen readers (the setting's title). */
  label: string;
  value: T | null;
  options: readonly Choice<T>[];
  onChange(value: T): void;
  /** The whole group is off. */
  disabled?: boolean;
  /** A change is being saved. */
  busy?: boolean;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.map((o) => !disabled && !o.disabled);
  const checked = options.findIndex((o) => o.value === value);
  const stop = choiceTabStop(checked, enabled);

  function keyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const rtl = typeof getComputedStyle === 'function' && getComputedStyle(e.currentTarget).direction === 'rtl';
    const to = choiceMove(e.key, index, enabled, rtl);
    if (to === index) return;
    e.preventDefault();
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  }

  return (
    <div ref={group} className={'choice-tiles' + (className ? ' ' + className : '')} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} aria-busy={busy || undefined}>
      {options.map((o, i) => {
        const on = i === checked;
        return (
          <button
            key={o.value} type="button" role="radio" className="choice-tile" aria-checked={on} tabIndex={i === stop ? 0 : -1}
            disabled={!enabled[i]} lang={o.lang} onKeyDown={(e) => keyDown(e, i)} onClick={() => { if (!on) onChange(o.value); }}
          >
            {on && <span className="choice-check" aria-hidden="true"><Icon name="check" size={12} /></span>}
            {o.sample !== undefined
              ? <span className="choice-sample" aria-hidden="true">{o.sample}</span>
              : o.icon ? <span className="choice-icon"><Icon name={o.icon} size={22} /></span> : null}
            <span className="choice-label">{o.label}</span>
            {o.hint && <span className="choice-hint">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
