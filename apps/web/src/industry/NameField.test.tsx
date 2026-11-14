import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Names } from '@qasa/core';

// The field is run as the form runs it, without a browser: its state is kept here between renders, and the test
// "types" by calling the input's own onChange.
const kept: { slots: unknown[]; at: number } = { slots: [], at: 0 };
vi.mock('react', async (original) => {
  const slot = <T,>(make: () => T): { index: number; value: T } => {
    const index = kept.at++;
    if (!(index in kept.slots)) kept.slots[index] = make();
    return { index, value: kept.slots[index] as T };
  };
  return {
    ...(await original<typeof import('react')>()),
    useRef: (first: unknown) => slot(() => ({ current: first })).value,
    useState: (first: unknown) => {
      const { index, value } = slot(() => first);
      return [value, (next: unknown) => { kept.slots[index] = next; }];
    }
  };
});
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }));

const { NameField } = await import('./NameField.tsx');

type Props = { children?: ReactNode; value?: string; onChange?(e: { target: { value: string } }): void; onClick?(): void };

/** Every element of a rendered tree, the outer ones first. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Props>;
  return [el, ...elements(el.props.children)];
}

/** A form holding one name: what the field shows, typing into it, and its buttons by their text key. */
function form(start: Names) {
  let names = start;
  const render = () => { kept.at = 0; return elements(NameField({ label: 'Name', value: names, onChange: (next) => { names = next; } })); };
  const button = (key: string) => render().find((el) => el.type === 'button' && el.props.children === key);
  return {
    names: () => names,
    shown: () => render().filter((el) => el.type === 'input').map((el) => el.props.value),
    type: (text: string, input = 0) => render().filter((el) => el.type === 'input')[input]!.props.onChange!({ target: { value: text } }),
    has: (key: string) => !!button(key),
    press: (key: string) => button(key)!.props.onClick!()
  };
}

beforeEach(() => { kept.slots = []; kept.at = 0; });

describe('the one name field', () => {
  it('writes a new name, or one that is the same in every language, to all three', () => {
    const fresh = form({ ar: '', en: '', ku: '' });
    fresh.type('Cola');
    expect(fresh.names()).toEqual({ ar: 'Cola', en: 'Cola', ku: 'Cola' });
    expect(fresh.has('it_namesDiffer')).toBe(false);
  });

  it('keeps the other languages of an older record when the field is emptied and typed again', () => {
    for (const ku of ['', 'تفاح', 'سێو']) {
      const f = form({ ar: 'تفاح', en: 'Apple', ku });
      expect(f.shown()).toEqual(['Apple']);
      f.type(''); // select all, Delete
      expect(f.names()).toEqual({ ar: 'تفاح', en: '', ku });
      expect(f.shown()).toEqual(['']);
      expect(f.has('it_namesDiffer')).toBe(true); // the way to the three names stays
      f.type('B');
      f.type('Big apple');
      expect(f.names()).toEqual({ ar: 'تفاح', en: 'Big apple', ku });
    }
  });

  it('keeps them too when what is typed passes through the other language’s text', () => {
    const f = form({ ar: 'Pen', en: 'Pens', ku: '' });
    f.type('Pen');
    f.type('Pencil');
    expect(f.names()).toEqual({ ar: 'Pen', en: 'Pencil', ku: '' });
  });

  it('writes all three only after "one name for every language" was pressed', () => {
    const f = form({ ar: 'تفاح', en: 'Apple', ku: '' });
    f.press('it_namesDiffer');
    expect(f.shown()).toEqual(['تفاح', '', 'Apple']);
    f.type('سێو', 1);
    expect(f.names()).toEqual({ ar: 'تفاح', en: 'Apple', ku: 'سێو' });
    f.press('it_namesOne');
    expect(f.names()).toEqual({ ar: 'Apple', en: 'Apple', ku: 'Apple' });
    expect(f.has('it_namesDiffer')).toBe(false);
    f.type('Red apple');
    expect(f.names()).toEqual({ ar: 'Red apple', en: 'Red apple', ku: 'Red apple' });
  });
});
