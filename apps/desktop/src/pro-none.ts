import type { ProModule } from './pro-types.ts';

/** Builds without the Pro module (anyone building from the public source) get this: no office network. */
export const proModule: ProModule | null = null;
