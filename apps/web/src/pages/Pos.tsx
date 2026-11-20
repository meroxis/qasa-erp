import { ErrorBox, useLoad } from '../components.tsx';
import { currentShift } from '../pos/shared.ts';
import { OpenShift } from '../pos/OpenShift.tsx';
import { Register } from '../pos/Register.tsx';

/**
 * Point of sale (every plan). Made for a cashier with no training: the search box always has the focus, so a barcode
 * scanner (which types the code and Enter) adds the item at once; big buttons for touch screens; F-keys for speed.
 * Each sale is a cash sale invoice posted at once into the shift's safe; the receipt prints on an 80 mm printer.
 *
 * 2.0: the till is split into the files of src/pos/ (the register, the cart, the payment, the status bar, the dialogs,
 * the receipt, opening and closing a shift, the X/Z report); this page opens the shift this person runs, or one.
 */
export function Pos() {
  const { data, error, reload } = useLoad(() => currentShift(), []);
  const shift = data?.shift ?? null;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return shift ? <Register key={shift.id} initial={shift} onClosed={reload} /> : <OpenShift onOpened={reload} />;
}

export { shiftTime } from '../pos/shared.ts';
export { QuickRow, PosCategories } from '../pos/Tiles.tsx';
export { CartName } from '../pos/CartName.tsx';
export { TillEquivalent } from '../pos/TillEquivalent.tsx';
export { PosShiftReport } from '../pos/ShiftReport.tsx';
