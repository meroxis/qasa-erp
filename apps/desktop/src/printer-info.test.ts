import { describe, expect, it, vi } from 'vitest';
import {
  cachedPrinters, guessPrinter, parseDefaultDevice, parseWindowsPrinters, POWERSHELL_ARGS, powershellPath, PRINTERS_COMMAND, readWindowsPrinters, REG_ARGS,
  regPath, windowsDir
} from './printer-info.ts';

const row = (over: object) => ({ Name: 'Office Laser', Default: false, WorkOffline: false, PrinterStatus: 3, DriverName: 'HP Universal Printing PCL 6', PrinterPaperNames: ['A4', 'Letter'], ...over });

describe('what Windows says about its printers', () => {
  it('reads the default printer and each one’s state, and leaves out what is not a printer', () => {
    const list = parseWindowsPrinters(JSON.stringify([
      row({ Default: true }),
      row({ Name: 'XP-80C', PrinterStatus: 7, DriverName: 'XP-80C', PrinterPaperNames: ['80(72) x 297 mm'] }),
      row({ Name: 'Labels', WorkOffline: true }),
      row({ Name: 'Unknown one', PrinterStatus: 2 }),
      row({ Name: 'Office Laser' }), // twice: once is enough
      row({ Name: 'bad\u0000name' }), row({ Name: 42 }), null, 'text'
    ]));
    expect(list.map((p) => [p.name, p.isDefault, p.state])).toEqual([
      ['Office Laser', true, 'ready'], ['XP-80C', false, 'offline'], ['Labels', false, 'offline'], ['Unknown one', false, 'unknown']
    ]);
    // one printer comes as an object, not a list
    expect(parseWindowsPrinters('\uFEFF' + JSON.stringify(row({ Default: true })))).toMatchObject([{ name: 'Office Laser', isDefault: true }]);
    expect(parseWindowsPrinters('Get-CimInstance : Access denied')).toEqual([]);
    expect(parseWindowsPrinters('')).toEqual([]);
  });

  it('reads the default printer from the registry answer, commas in its name and all', () => {
    const answer = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows\r\n    Device    REG_SZ    Microsoft Print to PDF,winspool,Ne00:\r\n\r\n';
    expect(parseDefaultDevice(answer)).toBe('Microsoft Print to PDF');
    expect(parseDefaultDevice('    Device    REG_SZ    Mer, front desk,winspool,Ne02:')).toBe('Mer, front desk');
    expect(parseDefaultDevice('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
  });

  it('asks with fixed commands only, by Windows’ own full paths, and falls back to the registry', async () => {
    const env = { SystemRoot: 'C:\\Windows' };
    expect(powershellPath(env)).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(regPath(env)).toBe('C:\\Windows\\System32\\reg.exe');
    // a folder name nobody would have (or a trick) is not used
    expect(windowsDir({ SystemRoot: '..\\evil' })).toBe('C:\\Windows');
    expect(windowsDir({ SystemRoot: 'C:\\Win"dows & calc' })).toBe('C:\\Windows');
    expect(windowsDir({})).toBe('C:\\Windows');
    expect(POWERSHELL_ARGS).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PRINTERS_COMMAND]);
    expect(PRINTERS_COMMAND).not.toMatch(/Invoke-Expression|iex |DownloadString|EncodedCommand|Bypass/i);

    const run = vi.fn(async (file: string) => (file.endsWith('powershell.exe') ? JSON.stringify([row({ Default: true })]) : ''));
    expect(await readWindowsPrinters(run, () => {}, env)).toMatchObject([{ name: 'Office Laser', isDefault: true, state: 'ready' }]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(powershellPath(env), POWERSHELL_ARGS);

    const noPowerShell = vi.fn(async (file: string) => {
      if (file.endsWith('powershell.exe')) throw new Error('blocked by policy');
      return '    Device    REG_SZ    XP-80C,winspool,Ne01:';
    });
    expect(await readWindowsPrinters(noPowerShell, () => {}, env)).toEqual([{ name: 'XP-80C', isDefault: true, state: 'unknown', driver: '', papers: [] }]);
    expect(noPowerShell).toHaveBeenLastCalledWith(regPath(env), REG_ARGS);
    expect(await readWindowsPrinters(async () => { throw new Error('nothing runs'); }, () => {}, env)).toEqual([]);
  });

  it('keeps an answer for a moment, and asks again when told to', async () => {
    let clock = 0;
    const read = vi.fn(async () => []);
    const cached = cachedPrinters(read, 1000, () => clock);
    await cached(); await cached();
    expect(read).toHaveBeenCalledTimes(1);
    await cached(true);
    expect(read).toHaveBeenCalledTimes(2);
    clock = 5000;
    await cached();
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('what a printer looks like (a suggestion)', () => {
  it('tells receipt rolls, label printers, page printers and file printers apart', () => {
    expect(guessPrinter({ name: 'XP-80C' })).toBe('receipt80');
    expect(guessPrinter({ name: 'POS-58 Series', driver: 'POS-58' })).toBe('receipt58');
    expect(guessPrinter({ name: 'EPSON TM-T20III Receipt' })).toBe('receipt80');
    expect(guessPrinter({ name: 'Cashier', driver: 'Generic', papers: ['80(72) x 297 mm', '80(72) x 3276 mm'] })).toBe('receipt80');
    expect(guessPrinter({ name: 'Cashier', papers: ['58(48) x 297 mm'] })).toBe('receipt58');
    expect(guessPrinter({ name: 'ZDesigner GK420t' })).toBe('label');
    expect(guessPrinter({ name: 'Xprinter XP-365B', driver: 'Xprinter XP-365B' })).toBe('label');
    expect(guessPrinter({ name: 'Barcode labels' })).toBe('label');
    expect(guessPrinter({ name: 'HP LaserJet Pro M404', papers: ['A4', 'Letter'] })).toBe('page');
    expect(guessPrinter({ name: 'Canon G3010 series' })).toBe('page');
    expect(guessPrinter({ name: 'Microsoft Print to PDF' })).toBe('file');
    expect(guessPrinter({ name: 'Fax' })).toBe('file');
    // a page printer whose driver also offers a roll size stays a page printer
    expect(guessPrinter({ name: 'Epson L3250', papers: ['A4', 'Letter', '80 x 297 mm'] })).toBe('page');
  });
});
