import type { ReactNode } from 'react';
import type { BusinessType } from '@qasa/core';
import type { BusinessGroup } from './business-cards.ts';

/**
 * The small pictures on the business cards: Qasa's own simple drawings (no brand, no logo), in two tones that follow
 * the theme (the accent and a soft tint of it, styles.css .biz-art). A type without one shows its group's picture.
 */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const SOFT = { className: 'soft' };

const ART: Partial<Record<BusinessType, ReactNode>> = {
  // a shop front with an awning
  trade: <>
    <rect {...SOFT} x="12" y="28" width="40" height="26" rx="3" />
    <path {...S} d="M10 22l4-10h36l4 10M10 22c0 3.3 2.7 6 6 6s6-2.7 6-6c0 3.3 2.7 6 6 6s6-2.7 6-6c0 3.3 2.7 6 6 6s6-2.7 6-6c0 3.3 2.7 6 6 6s6-2.7 6-6" />
    <path {...S} d="M14 28v26h36V28M27 54V40h10v14" />
  </>,
  // a basket with bread and a bottle
  market: <>
    <path {...SOFT} d="M12 30h40l-5 22H17z" />
    <path {...S} d="M8 30h48M12 30l5 22h30l5-22M22 30l8-16M42 30l-8-16M26 38v8M32 38v8M38 38v8" />
  </>,
  // a capsule and a bottle of syrup
  pharmacy: <>
    <rect {...SOFT} x="34" y="22" width="18" height="30" rx="4" />
    <path {...S} d="M34 26h18v26a3 3 0 0 1-3 3H37a3 3 0 0 1-3-3zM37 18h12v8H37zM39 36h8M43 32v8" />
    <path {...S} d="M12.9 41.1l9.2-9.2a6.5 6.5 0 0 1 9.2 9.2l-9.2 9.2a6.5 6.5 0 0 1-9.2-9.2zM17.5 36.5l9.2 9.2" />
  </>,
  // a phone
  mobileShop: <>
    <rect {...SOFT} x="20" y="10" width="24" height="44" rx="5" />
    <rect {...S} x="20" y="10" width="24" height="44" rx="5" />
    <path {...S} d="M29 15h6M30 48h4" />
  </>,
  // a wheel
  autoParts: <>
    <circle {...SOFT} cx="32" cy="32" r="20" />
    <circle {...S} cx="32" cy="32" r="20" />
    <circle {...S} cx="32" cy="32" r="6" />
    <path {...S} d="M32 12v14M32 38v14M12 32h14M38 32h14" />
  </>,
  // a spanner over a steel beam
  engineeringWorks: <>
    <path {...SOFT} d="M8 44h48v8H8z" />
    <path {...S} d="M8 44h48M8 52h48M14 44v8M50 44v8" />
    <path {...S} d="M40 12a8 8 0 0 0-7.6 10.4L18 36.8a3.4 3.4 0 0 0 4.8 4.8l14.4-14.4A8 8 0 0 0 47.6 19.6l-4.8 4.8-4.4-1-1-4.4 4.8-4.8A8 8 0 0 0 40 12z" />
  </>,
  // the sun over a solar panel
  electricalSolar: <>
    <path {...SOFT} d="M14 36h36l6 18H8z" />
    <path {...S} d="M14 36h36l6 18H8zM32 36v18M11 45h42M22 36l-2 18M42 36l2 18" />
    <circle {...S} cx="32" cy="18" r="5" />
    <path {...S} d="M32 6v3M32 27v3M20 18h3M41 18h3M23.5 9.5l2 2M38.5 24.5l2 2M40.5 9.5l-2 2" />
  </>,
  // a generator with a bolt
  generators: <>
    <rect {...SOFT} x="10" y="20" width="44" height="28" rx="4" />
    <rect {...S} x="10" y="20" width="44" height="28" rx="4" />
    <path {...S} d="M16 48v6M48 48v6M34 25l-6 10h8l-6 10" />
  </>,
  // a fuel pump
  petrolStation: <>
    <rect {...SOFT} x="14" y="12" width="22" height="42" rx="3" />
    <path {...S} d="M14 54V15a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v39M10 54h30M19 18h12v10H19zM36 30h4a3 3 0 0 1 3 3v10a3 3 0 0 0 6 0V24l-5-5" />
  </>,
  // two buildings
  realEstate: <>
    <path {...SOFT} d="M10 54V22l16-8v40zM30 54V28h24v26z" />
    <path {...S} d="M10 54V22l16-8v40M26 54V28h28v26M6 54h52M16 26h4M16 34h4M16 42h4M34 34h4M44 34h4M34 42h4M44 42h4" />
  </>
};

const GROUP_ART: Record<BusinessGroup, BusinessType> = { shops: 'trade', services: 'engineeringWorks', energy: 'electricalSolar', property: 'realEstate' };

export function BusinessArt({ type, group, size = 56 }: { type: BusinessType; group: BusinessGroup; size?: number }) {
  return (
    <svg className="biz-art" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      {ART[type] ?? ART[GROUP_ART[group]]}
    </svg>
  );
}
