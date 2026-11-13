import type { InvoiceKind } from '@qasa/core';
import type { Permission } from '../api.ts';
import type { PrintResult } from './printing.ts';

/**
 * The invoice editor's one button (pages/Invoices.tsx): "Save, print and next" and its other ways, which one the
 * person used last, and the order things happen in. The order is the promise: the invoice is posted first, exactly as
 * the Post button posts it; a refusal stops there (nothing prints, the invoice stays open with the reason); a paper that
 * did not print never undoes the posting, the person is told instead; only then does the next empty invoice open.
 */

export const SAVE_CHOICES = ['print_next', 'print', 'next', 'whatsapp', 'post', 'draft'] as const;
export type SaveChoice = (typeof SAVE_CHOICES)[number];
export const isSaveChoice = (v: unknown): v is SaveChoice => typeof v === 'string' && (SAVE_CHOICES as readonly string[]).includes(v);

/** The same rule as the server's (routes.ts, invoicePermission): sales posts sales, purchasing posts purchases. */
export const invoicePermission = (kind: InvoiceKind): Permission => (kind === 'purchase' ? 'purchases' : 'sales');

/**
 * Whether the person may post this kind of invoice, as far as the app knows before asking the server (unknown
 * permissions: yes, and the server decides). Someone who may only prepare gets "Save and next", which keeps a draft.
 */
export function mayPostInvoice(permissions: readonly Permission[] | undefined, kind: InvoiceKind): boolean {
  return !permissions || permissions.includes(invoicePermission(kind));
}

/**
 * The ways the button offers, the first being its default: a sale prints for the customer and can go to WhatsApp; a
 * purchase is first of all saved, and can be printed. "post" is the Post button as it was: it posts and opens the
 * invoice's own page. Someone who may only prepare gets the two that keep a draft.
 */
export function saveChoices(kind: InvoiceKind, canPost: boolean): SaveChoice[] {
  if (!canPost) return ['next', 'draft'];
  return kind === 'sale' ? ['print_next', 'print', 'next', 'whatsapp', 'post', 'draft'] : ['next', 'print_next', 'print', 'post', 'draft'];
}

export interface SavePlan { post: boolean; print: boolean; next: boolean; whatsapp: boolean }

/** What one way does. Without the right to post, nothing is posted, printed or sent: it stays a draft. */
export function planOf(choice: SaveChoice, canPost: boolean): SavePlan {
  const post = canPost && choice !== 'draft';
  return {
    post,
    print: post && (choice === 'print_next' || choice === 'print'),
    next: choice === 'print_next' || choice === 'next',
    whatsapp: post && choice === 'whatsapp'
  };
}

/** Where the last choice is kept: on this PC, per person and per kind of invoice. */
export interface ChoiceStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

const storeKey = (userKey: string, kind: InvoiceKind) => `qasa.invoiceSave.${kind}.${userKey.slice(0, 120)}`;

function browserStore(): ChoiceStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The way this person used last for this kind of invoice, when it is still offered; else the first one offered. */
export function rememberedChoice(userKey: string, kind: InvoiceKind, offered: readonly SaveChoice[], store: ChoiceStore | null = browserStore()): SaveChoice {
  let saved: string | null = null;
  try {
    saved = store?.getItem(storeKey(userKey, kind)) ?? null;
  } catch {
    saved = null;
  }
  return isSaveChoice(saved) && offered.includes(saved) ? saved : offered[0] ?? 'draft';
}

export function rememberChoice(userKey: string, kind: InvoiceKind, choice: SaveChoice, store: ChoiceStore | null = browserStore()): void {
  try {
    store?.setItem(storeKey(userKey, kind), choice);
  } catch {
    // not kept: the button starts from its default next time
  }
}

/** A paper that reached the printer or the print window; anything else did not print. */
export const printedOk = (result: PrintResult | null): boolean => result === 'printed' || result === 'dialog';

/** What the flow needs of an invoice as the server answers it. */
export interface SavedDoc { id: string; actions?: readonly string[] | undefined }

export interface SaveFlowDeps<V extends SavedDoc> {
  /** the Post button's own question ("Post this invoice? …"); no: nothing happens */
  confirmPost(): boolean | Promise<boolean>;
  /** creates the draft, or updates it when it was saved before */
  saveDraft(): Promise<V>;
  /** the draft is saved: the editor keeps its id, so another try updates it instead of making a second one */
  onDraft(saved: V): void;
  /** posts it the way the Post button does (the same request, the same question about expired stock) */
  post(saved: V): Promise<V>;
  /** after posting (the balances changed); a failure here never reads as a failed posting */
  afterPost?(posted: V): void | Promise<void>;
  /** puts the posted invoice on paper with the person's printer settings */
  print(posted: V): Promise<PrintResult>;
}

export type SaveOutcome<V> =
  | { status: 'cancelled' }
  /** kept as a draft; `held`: the person wanted it posted, but may only prepare (the server's own answer says so) */
  | { status: 'draft'; invoice: V; next: boolean; held: boolean }
  /** posted; `printed` null: no paper was asked for */
  | { status: 'posted'; invoice: V; printed: PrintResult | null; next: boolean; whatsapp: boolean };

/**
 * Runs one way of saving. Throws what the server refused (saving or posting): the caller shows it and the invoice
 * stays open; by then nothing was printed and no next invoice was opened.
 */
export async function runSaveFlow<V extends SavedDoc>(choice: SaveChoice, canPost: boolean, deps: SaveFlowDeps<V>): Promise<SaveOutcome<V>> {
  const plan = planOf(choice, canPost);
  if (plan.post && !(await deps.confirmPost())) return { status: 'cancelled' };
  const draft = await deps.saveDraft();
  deps.onDraft(draft);
  // the server lists what this person may do with the draft: without "post" it stays one (separate duties)
  const postable = !Array.isArray(draft.actions) || draft.actions.includes('post');
  if (!plan.post || !postable) return { status: 'draft', invoice: draft, next: plan.next, held: plan.post };
  const posted = await deps.post(draft);
  try {
    await deps.afterPost?.(posted);
  } catch {
    // it is posted all the same
  }
  let printed: PrintResult | null = null;
  if (plan.print) {
    try {
      printed = await deps.print(posted);
    } catch {
      printed = 'failed';
    }
  }
  return { status: 'posted', invoice: posted, printed, next: plan.next, whatsapp: plan.whatsapp };
}
