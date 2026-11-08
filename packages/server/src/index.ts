export {
  COMPANY_TABLES, createMysqlTriggers, isMysql, migrate, mysqlCompanyTables, nextSequence, openDatabase, prepareMysqlForCopy, schemaVersion,
  SCHEMA_VERSION, initDatabase, transaction, type Db, type DbStatement, type SqlParam, type SqlValue
} from './db.ts';
export { copyCompany, CopyError, type CopySummary } from './db-copy.ts';
export { MYSQL_TRIGGERS } from './schema-mysql.ts';
export { buildApp } from './app.ts';
// for the Pro module: who is asking, the plan, settings, the audit log, and routes of its own (ApiExtension)
export { ApiReply, requestActor, type ApiExtension, type ApiRequest, type HttpMethod, type Route } from './routes.ts';
export { signInRequired, type Actor, type Permission } from './auth.ts';
export { planStatus } from './license.ts';
export { configureLicensing, machineId, noteFirstStartBeforeCarry } from './activation.ts';
export { getSettings, readSetting, writeSetting } from './settings.ts';
export { audit } from './audit.ts';
export { AppError, conflict, invalid, notFound } from './errors.ts';
export { createJournalEntry, createVoucher, deleteEntry, getEntry, postVoucherNow, reverseEntryInternal, type EntryView } from './journal.ts';
export { loadAccounts } from './accounts.ts';
export { createInvoice, getInvoice, postInvoice, type InvoiceView } from './invoices.ts';
export { createItem, listWarehouses } from './items.ts';
export { createParty, getParty, updateParty } from './parties.ts';
export { startUsagePings, usageApi } from './usage.ts';
// for the desktop app: keep the invoice QR signing key protected with the PC's own secret store
export { configureVerifyKeyVault, type SecretVault } from './verify.ts';
