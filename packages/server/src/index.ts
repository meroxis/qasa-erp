export {
  COMPANY_TABLES, createMysqlTriggers, isMysql, migrate, mysqlCompanyTables, nextSequence, openDatabase, prepareMysqlForCopy, schemaVersion,
  SCHEMA_VERSION, initDatabase, transaction, type Db, type DbStatement, type SqlParam, type SqlValue
} from './db.ts';
export { copyCompany, CopyError, type CopySummary } from './db-copy.ts';
export { MYSQL_TRIGGERS } from './schema-mysql.ts';
export { buildApp } from './app.ts';
// for the Pro module: who is asking, the plan, settings, the audit log, and routes of its own (ApiExtension)
export { ApiReply, requestActor, type ApiExtension, type ApiRequest, type HttpMethod, type Route } from './routes.ts';
export { adminUsernames, auditUnconfirmedReset, recoverAdminWithCode, resetAdminOnThisPc, signInRequired, type Actor, type Permission } from './auth.ts';
export { planStatus } from './license.ts';
export { configureLicensing, machineId, noteFirstStartBeforeCarry } from './activation.ts';
export { getSettings, readSetting, writeSetting } from './settings.ts';
export { audit } from './audit.ts';
export { AppError, conflict, invalid, notFound } from './errors.ts';
export { createJournalEntry, createVoucher, deleteEntry, getEntry, postVoucherNow, reverseEntryInternal, type EntryView } from './journal.ts';
export { loadAccounts } from './accounts.ts';
export { createInvoice, getInvoice, onlinePaidAmount, postInvoice, type InvoiceView } from './invoices.ts';
export { createItem, listWarehouses } from './items.ts';
// for the Pro module (1.1): units, batches, categories and an invoice's payments
export { itemUnits, unitsByItem, type ItemUnitView } from './item-units.ts';
export { batchReport, batchSettings, batchStock, expiryAlert, type BatchReportRow } from './batches.ts';
export { IN_CATEGORY_SQL, listCategories, type CategoryView } from './categories.ts';
export { assertItemBrand, brandIdForName, listBrands, type BrandView } from './brands.ts';
export { isPeriodLocked } from './settings.ts';
export { createParty, getParty, updateParty } from './parties.ts';
// for the Pro module: a user limited to some branches works only with their warehouses and safes (branches.ts)
export { defaultWarehouseId, entryInBranchSql, scopeLists, scopeOf, visibleEntryIds, type BranchScope } from './branches.ts';
export { startUsagePings, usageApi } from './usage.ts';
// for the desktop app: keep the invoice QR signing key protected with the PC's own secret store
export { configureVerifyKeyVault, type SecretVault } from './verify.ts';
