import { describe, expect, it } from 'vitest';
import { fuelAmount, meterText, parseMeter, readingProblem, shiftCash, shiftTotals } from './fuel.ts';

// Petrol stations (prototype): a shift's litres from its meter readings, their money, and the cash against it.
describe('meter readings', () => {
  it('reads what a person types, in Western, Arabic or Persian digits, to millilitres', () => {
    expect(parseMeter('123456.78')).toBe(123_456_780);
    expect(parseMeter('١٢٣٤٥٦٫٧٨')).toBe(123_456_780);
    expect(parseMeter('۱۲۳')).toBe(123_000);
    expect(parseMeter('123,456.5')).toBe(123_456_500);
    expect(parseMeter(' 42 ')).toBe(42_000);
  });
  it('refuses what is not a reading', () => {
    for (const bad of ['', 'abc', '-5', '1.2345', '1e5', '12345678901', '1..2']) expect(parseMeter(bad), bad).toBeNull();
  });
  it('writes millilitres back as litres without trailing zeros', () => {
    expect(meterText(123_456_780)).toBe('123456.78');
    expect(meterText(42_000)).toBe('42');
    expect(meterText(5)).toBe('0.005');
  });
});

describe('a shift sheet', () => {
  const reading = (nozzleId: string, fuelTypeId: string, price: number, opening: number, closing: number | null) =>
    ({ nozzleId, fuelTypeId, price, openingMilli: opening, closingMilli: closing });

  it('money is litres × price per litre, to whole dinars, half up', () => {
    expect(fuelAmount(1_000, 850)).toBe(850);
    expect(fuelAmount(612_400, 850)).toBe(520_540);
    expect(fuelAmount(1, 500)).toBe(1); // 0.5 dinar rounds up
    expect(fuelAmount(1, 499)).toBe(0);
  });

  it('litres are closing − opening, totalled per fuel', () => {
    const t = shiftTotals([
      reading('n1', 'reg', 850, 100_000_000, 100_600_000),
      reading('n2', 'reg', 850, 200_000_000, 200_400_500),
      reading('n3', 'dsl', 750, 50_000_000, 50_300_000)
    ]);
    expect(t.lines.map((l) => l.milli)).toEqual([600_000, 400_500, 300_000]);
    expect(t.byFuel).toEqual([
      { fuelTypeId: 'reg', price: 850, milli: 1_000_500, amount: 510_000 + 340_425 },
      { fuelTypeId: 'dsl', price: 750, milli: 300_000, amount: 225_000 }
    ]);
    expect(t.sales).toBe(510_000 + 340_425 + 225_000);
    expect(t.milli).toBe(1_300_500);
  });

  it('a missing or wrong closing reading counts as nothing sold, and says what is wrong', () => {
    expect(readingProblem({ openingMilli: 1000, closingMilli: null })).toBe('closing_missing');
    expect(readingProblem({ openingMilli: 1000, closingMilli: 999 })).toBe('closing_below_opening');
    expect(readingProblem({ openingMilli: -1, closingMilli: 5 })).toBe('reading_invalid');
    expect(readingProblem({ openingMilli: 1000, closingMilli: 1.5 })).toBe('reading_invalid');
    expect(readingProblem({ openingMilli: 1000, closingMilli: 1000 })).toBeNull();
    const t = shiftTotals([reading('n1', 'reg', 850, 5_000, 4_000), reading('n2', 'reg', 850, 5_000, null)]);
    expect(t.sales).toBe(0);
  });

  it('expected cash is sales less credit; the difference is a shortage below zero and cash over above it', () => {
    expect(shiftCash(1_000_000, 50_000, 950_000)).toMatchObject({ expected: 950_000, difference: 0, result: 'exact' });
    expect(shiftCash(1_000_000, 0, 992_500)).toMatchObject({ expected: 1_000_000, difference: -7_500, result: 'short' });
    expect(shiftCash(1_000_000, 0, 1_002_000)).toMatchObject({ difference: 2_000, result: 'over' });
  });
});
