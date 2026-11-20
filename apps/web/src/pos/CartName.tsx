import { useState } from 'react';

/**
 * A cart line's name. It is held to two lines; a long one is read in full by a tap (or Enter on it), which opens it,
 * and another tap closes it. On a touch screen there is no pointer to rest on it for the title.
 */
export function CartName({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  return (
    <span role="button" tabIndex={0} title={name} aria-expanded={open} className={open ? 'pos-name-open' : undefined}
      onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>{name}</span>
  );
}

