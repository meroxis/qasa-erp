import { expect, it, vi } from 'vitest';
vi.mock('../components.tsx', () => ({}));
vi.mock('../industry/market-extras-api.ts', () => ({}));
vi.mock('../industry/LockedFeature.tsx', () => ({}));
vi.mock('../api.ts', () => ({ api: {} }));
vi.mock('../i18n.ts', () => ({}));
import { deviceBases, deviceLink } from './PriceCheckers.tsx';

// 2.0.0: in the Windows app the page is 127.0.0.1, which a tablet can't open: the office network's addresses instead
it('builds the tablet link with the office network address when the page is this PC only', () => {
  const here = { origin: 'http://127.0.0.1:47411', pathname: '/', hostname: '127.0.0.1' };
  expect(deviceBases(here, { on: true, port: 47420, addresses: ['192.168.1.20'] })).toEqual(['https://192.168.1.20:47420/']);
  expect(deviceBases(here, { on: false, port: 47420, addresses: ['192.168.1.20'] })).toEqual(['http://127.0.0.1:47411/']);
  expect(deviceBases({ origin: 'https://192.168.1.20:47420', pathname: '/', hostname: '192.168.1.20' }, null)).toEqual(['https://192.168.1.20:47420/']);
  expect(deviceLink('abc', 'https://192.168.1.20:47420/')).toBe('https://192.168.1.20:47420/#/price-checker?token=abc');
});
