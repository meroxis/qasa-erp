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
import { brandsApi } from './brands.ts';
import { outboxApi } from './outbox.ts';
import { dayCloseApi } from './day-close.ts';
import { loyaltyApi } from './loyalty.ts';
import { quickVouchersApi } from './quick-vouchers.ts';
import { stockCorrectionApi } from './stock-correction.ts';
import { expensesApi } from './expenses.ts';
import { fuelApi } from './fuel.ts';
import { goldApi } from './gold.ts';
import { clothingApi } from './clothing.ts';
import { slowStockApi } from './slow-stock.ts';
import { shelfLabelsApi } from './shelf-labels.ts';
import { posTillsApi } from './pos-tills.ts';
import { featureAccountsApi } from './feature-accounts.ts';
import { tillRulesApi } from './till-rules.ts';
import { wholesaleApi } from './wholesale.ts';
import { consignmentApi } from './consignment.ts';
import { offersApi } from './offers.ts';
import { deliveryApi } from './delivery.ts';
import { debtRemindersApi } from './debt-reminders.ts';
import { priceCheckerApi } from './price-checker.ts';
import { dailySuppliersApi } from './daily-suppliers.ts';

import { tillReturnsApi } from './till-returns.ts';
import { productLookupApi } from './product-lookup.ts';
/**
 * The app's own features that are built like modules (each in a file of its own, as an ApiExtension): served on every
 * edition, the website demo included, behind the same sign-in, permission and same-site checks as the rest of the API.
 */
export const BUILT_IN_FEATURES: readonly ApiExtension[] = [posApi, mediaApi, quotesApi, activationApi, briefApi, fxApi, verifyApi, usageApi, branchesApi, bankingApi, assetsApi, adjustmentsApi, purchasingApi, pricesApi, printProfileApi, batchesApi, categoriesApi, brandsApi, outboxApi, dayCloseApi, loyaltyApi, quickVouchersApi, stockCorrectionApi,
  expensesApi, fuelApi, slowStockApi, shelfLabelsApi, posTillsApi, featureAccountsApi, tillRulesApi, consignmentApi, offersApi, goldApi, wholesaleApi, deliveryApi, debtRemindersApi, priceCheckerApi, dailySuppliersApi, clothingApi, tillReturnsApi, productLookupApi];
