import { describe, expect, it } from 'vitest';
import { creditedSources, creditNames, publicBarcode } from './product-lookup.ts';
import { internalBarcode } from './clothing.ts';

describe('which barcodes may be asked about online', () => {
  it('a manufacturer’s barcode passes as it is', () => {
    expect(publicBarcode('5449000000996')).toBe('5449000000996');
    expect(publicBarcode(' 6291003000010 ')).toBe('6291003000010');
    expect(publicBarcode('036000291452')).toBe('036000291452'); // UPC-A
    expect(publicBarcode('96385074')).toBe('96385074'); // EAN-8
    expect(publicBarcode('15449000000993')).toBe('15449000000993'); // a case code (GTIN-14)
  });

  it('the shop’s own codes never do: scale labels, the 02 and 04 ranges, short codes', () => {
    expect(publicBarcode('2100017012503')).toBeNull(); // a scale's label
    expect(publicBarcode('2100017')).toBeNull(); // a weighed item's own barcode
    expect(publicBarcode(internalBarcode(17))).toBeNull(); // a variant numbered by the app (04…)
    expect(publicBarcode('0212345678909')).toBeNull();
    expect(publicBarcode('212345678909')).toBeNull(); // a UPC of the in-store range
    expect(publicBarcode('412345678903')).toBeNull();
    expect(publicBarcode('20000004')).toBeNull();
    expect(publicBarcode('1234567')).toBeNull();
    expect(publicBarcode('12345')).toBeNull();
  });

  it('nor does anything that is no barcode: letters, a wrong check digit, an odd length, nothing', () => {
    expect(publicBarcode('5449000000997')).toBeNull();
    expect(publicBarcode('ABC-5449000000996')).toBeNull();
    expect(publicBarcode('544900000099')).toBeNull();
    expect(publicBarcode('123456789')).toBeNull();
    expect(publicBarcode('٥٤٤٩٠٠٠٠٠٠٩٩٦')).toBeNull();
    expect(publicBarcode('')).toBeNull();
    expect(publicBarcode(null)).toBeNull();
    expect(publicBarcode('5449000000996?fields=x')).toBeNull();
  });
});

describe('the credit line', () => {
  it('names each database once, in one order, and skips what is no database', () => {
    expect(creditedSources(['openbeautyfacts', null, 'openfoodfacts', 'openfoodfacts', 'someone'])).toEqual(['openfoodfacts', 'openbeautyfacts']);
    expect(creditNames(['openfoodfacts', 'openbeautyfacts'])).toBe('Open Food Facts, Open Beauty Facts');
    expect(creditedSources([])).toEqual([]);
  });
});
