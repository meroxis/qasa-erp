/**
 * The weighing scale (2.0): the till reads a scale on a serial or USB-serial port through the browser's Web Serial in
 * the app window (apps/web/src/pos/scale.ts). Electron asks the app which port to use and whether the page may use
 * serial at all: only the app's own page, for serial alone (no camera, microphone or anything else, as before).
 */

export interface SerialPortChoice { portId: string; portName?: string; displayName?: string; vendorId?: string; productId?: string }

/** The port a scale is most likely on: a USB-serial adapter first, then the first COM port; none: '' (cancelled). */
export function pickScalePort(ports: readonly SerialPortChoice[]): string {
  if (!ports.length) return '';
  const usb = ports.find((p) => !!p.vendorId || /usb|ch34|cp21|ftdi|pl23|prolific/i.test(`${p.displayName ?? ''} ${p.portName ?? ''}`));
  return (usb ?? ports[0]!).portId;
}

/** Serial alone, for the app's own page alone. */
export const serialAllowed = (permission: string, requestOrigin: string, appOrigin: string): boolean =>
  permission === 'serial' && !!appOrigin && requestOrigin === appOrigin;
