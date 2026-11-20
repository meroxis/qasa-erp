import { roundHalfUp } from './money.ts';

/**
 * Gold and jewellery shops (goldShop). Weights are kept in milligrams (grams with three decimals), purity by karat,
 * and prices per gram in the minor units of their currency (dinars, or US cents).
 *
 * In Iraq gold is often quoted per mithqal: 5 grams (the "Iraqi mithqal"). The shop chooses how the board shows
 * prices; they are always stored per gram, so nothing is lost or rounded twice.
 */

export const GOLD_KARATS = [18, 21, 22, 24] as const;
export type GoldKarat = (typeof GOLD_KARATS)[number];

/** Grams of one Iraqi mithqal, in milligrams. */
export const MITHQAL_MG = 5000;

export type GoldPriceUnit = 'gram' | 'mithqal';
export type MakingKind = 'gram' | 'piece';

export function isGoldKarat(value: unknown): value is GoldKarat {
  return typeof value === 'number' && (GOLD_KARATS as readonly number[]).includes(value);
}

/** The pure (24 karat) gold in a weight of a karat, in milligrams. */
export function fineMg(weightMg: number, karat: number): number {
  return roundHalfUp((weightMg * karat) / 24);
}

/** Pure gold expressed as a weight of another karat (a supplier settled in 21 karat sees grams of 21). */
export function fineToKarat(fine: number, karat: number): number {
  return roundHalfUp((fine * 24) / karat);
}

/** A price per gram shown per gram or per mithqal. */
export function priceForUnit(perGram: number, unit: GoldPriceUnit): number {
  return unit === 'mithqal' ? perGram * (MITHQAL_MG / 1000) : perGram;
}

/** A price typed per gram or per mithqal, kept per gram. */
export function perGramFrom(amount: number, unit: GoldPriceUnit): number {
  return unit === 'mithqal' ? roundHalfUp(amount / (MITHQAL_MG / 1000)) : amount;
}

/** A karat's price worked out from the 24 karat price (the usual way a board is filled). */
export function karatPrice(price24: number, karat: number): number {
  return roundHalfUp((price24 * karat) / 24);
}

/** What a weight costs at a price per gram. */
export function goldValue(weightMg: number, perGram: number): number {
  return roundHalfUp((weightMg * perGram) / 1000);
}

/** The making charge of a piece: per gram of its weight, or one amount for the piece. */
export function makingCharge(weightMg: number, kind: MakingKind, amount: number): number {
  return kind === 'gram' ? goldValue(weightMg, amount) : amount;
}

/** A piece's price: its weight at the day's selling price of its karat, plus the making charge. */
export function goldPiecePrice(piece: { weightMg: number; makingKind: MakingKind; makingAmount: number }, sellPerGram: number): number {
  return goldValue(piece.weightMg, sellPerGram) + makingCharge(piece.weightMg, piece.makingKind, piece.makingAmount);
}
