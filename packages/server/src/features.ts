import type { ApiExtension } from './routes.ts';

/**
 * The app's own features that are built like modules (each in a file of its own, as an ApiExtension): served on every
 * edition, the website demo included, behind the same sign-in, permission and same-site checks as the rest of the API.
 */
export const BUILT_IN_FEATURES: readonly ApiExtension[] = [];
