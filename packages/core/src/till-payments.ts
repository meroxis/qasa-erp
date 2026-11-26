/**
 * Card and wallet payments at the till (card, FIB, ZainCash, Qi). 2.0.0 (owner's decision): the till takes cash (dinars
 * and dollar notes), credit and gift vouchers only. The server's card and wallet code, its accounts and its tests stay
 * as they are (dormant: nothing in the app sets those accounts while this is off), so turning this on later needs no
 * migration. It is not a setting anyone sees.
 */
export const TILL_CARD_PAYMENTS = false as boolean;
