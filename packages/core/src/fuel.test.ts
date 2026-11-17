import { describe, expect, it } from 'vitest';
import { averageCost, chartProblem, dipLitres, dipVariance, fuelAmount, meterText, mulDiv, parseDipCm, parseMeter, readingProblem, shiftCash, shiftTotals, soldMilli, tankCostOut, withinTolerance } from './fuel.ts';

// Petrol stations: a shift's litres from its meter readings, their money, and the cash against it.
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

describe('a meter that rolled over', () => {
  const max = 999_999_990; // 999999.99
  it('counts maximum − opening + closing litres, only when the person said so', () => {
    const r = { openingMilli: 999_900_000, closingMilli: 150_000, meterMaxMilli: max, limitMilli: 40_000_000 };
    expect(readingProblem(r)).toBe('closing_below_opening');
    expect(soldMilli(r)).toBe(0);
    expect(readingProblem({ ...r, rollover: true })).toBeNull();
    expect(soldMilli({ ...r, rollover: true })).toBe(max - 999_900_000 + 150_000); // 249.99 L
  });
  it('refuses a rollover that is not one, or that would make more litres than the tank holds', () => {
    expect(readingProblem({ openingMilli: 1_000, closingMilli: 5_000, rollover: true })).toBe('rollover_not_needed');
    // a mistyped closing reading far below the opening one is not passed off as a rollover
    expect(readingProblem({ openingMilli: 500_000_000, closingMilli: 100_000_000, rollover: true, meterMaxMilli: max, limitMilli: 40_000_000 })).toBe('rollover_implausible');
    // a reading above the meter's maximum is no reading
    expect(readingProblem({ openingMilli: 1_000, closingMilli: max + 10, meterMaxMilli: max })).toBe('reading_invalid');
  });
  it('totals a rolled-over nozzle with the others', () => {
    const t = shiftTotals([{ nozzleId: 'n1', fuelTypeId: 'reg', price: 1000, openingMilli: 999_000_000, closingMilli: 1_000_000, rollover: true, meterMaxMilli: max }]);
    expect(t.milli).toBe(1_999_990);
    expect(t.sales).toBe(1_999_990); // 1999.99 L at 1,000 a litre
  });
});

describe('a tank\'s calibration chart', () => {
  const chart = [{ mm: 0, milli: 0 }, { mm: 1000, milli: 10_000_000 }, { mm: 2000, milli: 25_000_000 }];
  it('reads a dip straight between the rows around it, and nothing outside the chart', () => {
    expect(dipLitres(chart, 0)).toBe(0);
    expect(dipLitres(chart, 500)).toBe(5_000_000);
    expect(dipLitres(chart, 1500)).toBe(17_500_000);
    expect(dipLitres(chart, 2000)).toBe(25_000_000);
    expect(dipLitres(chart, 1)).toBe(10_000); // 0.1 cm = 10 L on the first part
    expect(dipLitres(chart, 2001)).toBeNull();
    expect(dipLitres([{ mm: 100, milli: 1_000 }, { mm: 200, milli: 2_000 }], 50)).toBeNull();
  });
  it('takes a chart that rises row by row and fits the tank', () => {
    expect(chartProblem(chart, 25_000_000)).toBeNull();
    expect(chartProblem([chart[0]!], 25_000_000)).toBe('chart_too_short');
    expect(chartProblem([chart[1]!, chart[0]!], 25_000_000)).toBe('chart_not_rising');
    expect(chartProblem([{ mm: 0, milli: 5 }, { mm: 10, milli: 4 }], 25_000_000)).toBe('chart_not_rising');
    expect(chartProblem(chart, 24_000_000)).toBe('chart_over_capacity');
    expect(chartProblem([{ mm: 0, milli: 0 }, { mm: 1.5, milli: 10 }], 25_000_000)).toBe('chart_row_invalid');
  });
  it('reads a stick in centimetres to one decimal', () => {
    expect(parseDipCm('152.5')).toBe(1525);
    expect(parseDipCm('١٥٢٫٥')).toBe(1525);
    expect(parseDipCm('152.55')).toBeNull();
    expect(parseDipCm('abc')).toBeNull();
  });
});

describe('a tank\'s average cost', () => {
  it('is value ÷ litres, the last delivery\'s price when the tank holds nothing', () => {
    expect(averageCost({ milli: 10_000_000, value: 7_850_000 }, 900)).toBe(785);
    expect(averageCost({ milli: 0, value: 0 }, 900)).toBe(900);
  });
  it('moves with a delivery at another price, and litres leave at it', () => {
    // 10,000 L at 780 and 5,000 L at 810: 15,000 L worth 11,850,000, 790 a litre
    const stock = { milli: 15_000_000, value: 7_800_000 + 4_050_000 };
    expect(averageCost(stock, 0)).toBe(790);
    expect(tankCostOut(stock, 1_500_000, 0)).toBe(1_185_000);
    // the whole tank takes the whole value: nothing is left behind by rounding
    expect(tankCostOut({ milli: 3, value: 10 }, 3, 0)).toBe(10);
    expect(tankCostOut({ milli: 3, value: 10 }, 1, 0)).toBe(3);
    // nothing in the book: at the last price
    expect(tankCostOut({ milli: 0, value: 0 }, 2_000, 700)).toBe(1_400);
  });
  it('rounds exactly for large litres and values', () => {
    expect(mulDiv(999_999_999_999, 9_999_999, 1000)).toBe(9_999_998_999_990_001);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
  });
});

describe('a dip against the book', () => {
  it('is a gain above it and a loss below it, normal within the tolerance', () => {
    expect(dipVariance(19_940_000, 20_000_000)).toBe(-60_000);
    expect(withinTolerance(-60_000, 20_000_000, 50)).toBe(true); // 0.3% within 0.5%
    expect(withinTolerance(-120_000, 20_000_000, 50)).toBe(false); // 0.6%
    expect(withinTolerance(100_000, 20_000_000, 50)).toBe(true);
  });
});
