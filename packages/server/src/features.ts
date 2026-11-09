import type { ApiExtension } from './routes.ts';
import { activationApi } from './activation.ts';
import { briefApi } from './brief.ts';
import { fxApi } from './fx.ts';
import { verifyApi } from './verify.ts';
import { usageApi } from './usage.ts';
import { branchesApi } from './branches.ts';
import { bankingApi } from './banking.ts';
import { assetsApi } from './assets.ts';
import { adjustmentsApi } from './adjustments.ts';
import { purchasingApi } from './purchasing.ts';
import { pricesApi } from './prices.ts';
import { printProfileApi } from './print-profile.ts';
import { mediaApi } from './media.ts';
import { posApi } from './pos.ts';
import { quotesApi } from './quotes.ts';
import { batchesApi } from './batches.ts';
import { categoriesApi } from './categories.ts';

/**
 * The app's own features that are built like modules (each in a file of its own, as an ApiExtension): served on every
 * edition, the website demo included, behind the same sign-in, permission and same-site checks as the rest of the API.
 */
export const BUILT_IN_FEATURES: readonly ApiExtension[] = [posApi, mediaApi, quotesApi, activationApi, briefApi, fxApi, verifyApi, usageApi, branchesApi, bankingApi, assetsApi, adjustmentsApi, purchasingApi, pricesApi, printProfileApi, batchesApi, categoriesApi];
