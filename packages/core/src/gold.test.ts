import { describe, expect, it } from 'vitest';
import { fineMg, fineToKarat, goldPiecePrice, goldValue, isGoldKarat, karatPrice, makingCharge, MITHQAL_MG, perGramFrom, priceForUnit } from './gold.ts';

describe('gold weights, karats and prices', () => {
  it('works out pure gold from a weight and karat, and back to another karat', () => {
    expect(fineMg(5000, 21)).toBe(4375);
    expect(fineMg(5000, 24)).toBe(5000);
    expect(fineMg(10_000, 18)).toBe(7500);
    expect(fineToKarat(4375, 21)).toBe(5000);
    expect(fineToKarat(4375, 24)).toBe(4375);
    expect(isGoldKarat(21)).toBe(true);
    expect(isGoldKarat(14)).toBe(false);
  });

  it('keeps prices per gram and shows them per mithqal of 5 g', () => {
    expect(MITHQAL_MG).toBe(5000);
    expect(priceForUnit(100_000, 'mithqal')).toBe(500_000);
    expect(perGramFrom(500_000, 'mithqal')).toBe(100_000);
    expect(perGramFrom(100_000, 'gram')).toBe(100_000);
    expect(karatPrice(120_000, 21)).toBe(105_000);
    expect(karatPrice(120_000, 18)).toBe(90_000);
  });

  it('prices a piece: weight × the karat’s selling price + making per gram or per piece', () => {
    expect(goldValue(5000, 100_000)).toBe(500_000);
    expect(goldValue(1234, 100_000)).toBe(123_400);
    expect(makingCharge(5000, 'gram', 5_000)).toBe(25_000);
    expect(makingCharge(5000, 'piece', 30_000)).toBe(30_000);
    expect(goldPiecePrice({ weightMg: 5000, makingKind: 'gram', makingAmount: 5_000 }, 100_000)).toBe(525_000);
  });
});
