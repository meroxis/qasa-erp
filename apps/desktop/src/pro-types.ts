import type { FastifyInstance } from 'fastify';
import type { ApiExtension, Db } from '@qasa/server';

/**
 * The Pro module (office network and other paid features) is developed separately and included only in the
 * official Windows builds. It plugs into the app through this interface; public builds use pro-none.ts instead.
 */
export interface ProModule {
  name: string;
  version: string;
  /** API routes of its own, served with the app's (and on the office network), behind the same checks. */
  apiExtensions?: readonly ApiExtension[];
  /** Called before the app's own server starts listening: the only moment it can take more routes. */
  register?(ctx: ProContext): void;
  /** Called once the app's own server is running. */
  start?(ctx: ProContext): Promise<void> | void;
  /** Called before the app quits. */
  stop?(): Promise<void> | void;
  /**
   * 1.1: the normal backup now (encrypted when a backup password is set), for Start over with empty books; resolves
   * with the file's name once it is made and checked, throws when no copy was made.
   */
  backupNow?(): Promise<string>;
  /** 1.1: should closing the app make a backup (turned on, the plan has automatic backups, and the books changed)? */
  closingBackupNeeded?(): boolean;
  /** 1.1: the backup at closing (and its copy to a folder, and the cloud upload); throws when it failed. */
  closingBackup?(): Promise<string>;
  /**
   * 1.4: when the last backup of this company was made (ISO time), by any way (daily, Save a backup now, at closing),
   * or null. With it, closing does not ask "Back up before closing?" after a backup the app did not make itself.
   */
  lastBackupAt?(): string | null;
  /**
   * At start, before anything else: the company database on a MariaDB/MySQL server when this PC uses one, or null
   * for the company file. Throws a problem with a code, host, database and localCopy when the server can't be used.
   */
  openDatabase?(ctx: DatabaseStartContext): Db | null;
  /** After openDatabase failed: stop using the server, back to the company file kept aside at the move (its name in the data folder), or null. */
  useLocalCopyInstead?(ctx: DatabaseStartContext): string | null;
}

export interface DatabaseStartContext {
  userDataDir: string;
  /** where the company file is (qasa.sqlite) */
  dataDir: string;
  /** the database worker's code (dist/db-worker.cjs in the app) */
  workerSource: { file: string } | { code: string };
  revealSecret(stored: string): string;
  log(...args: unknown[]): void;
}

export interface RestartOptions {
  /** keeps the current company file aside under this name (in the data folder) */
  setAsideCompanyFile?: string;
  /** makes this file (in the data folder) the company file */
  useCompanyFile?: string;
}

export interface ProContext {
  db: Db;
  server: FastifyInstance;
  /** The folder with the company data and the app's settings. */
  userDataDir: string;
  /** The company open now on this PC (companies.ts): 'main' or another company's id; missing means 'main'. */
  companyId?: string;
  /** The folder with the company file (qasa.sqlite). */
  dataDir: string;
  /** The database worker's code, for a company database on a server. */
  workerSource: { file: string } | { code: string };
  /** Stops the app's server, moves company files as asked, and starts the app again. */
  restart(options?: RestartOptions): Promise<void>;
  appVersion: string;
  /** Serves the app's screens (the built web app) from a server, the way the app's own server does. */
  serveWeb(server: FastifyInstance): void;
  /** The headers every answer of the app carries (content security policy and the like). */
  securityHeaders: Readonly<Record<string, string>>;
  /** The Windows Documents folder (the default place for backups). */
  documentsDir: string;
  /**
   * A folder on this PC that no cloud service syncs (%LOCALAPPDATA%Qasa ERPBackups): where backups go while the
   * default folder is synced to the internet and there is no backup password. Missing: a Backups folder in userDataDir.
   */
  localBackupDir?: string;
  /** Windows' folder picker on this PC's window; null when cancelled. */
  chooseFolder(): Promise<string | null>;
  /** Windows' file picker for a backup to restore; null when cancelled. */
  chooseBackupFile(): Promise<string | null>;
  /** Replaces the company file with a checked backup and restarts the app; the current file is kept aside. */
  restoreDatabase(file: string): Promise<void>;
  /**
   * 1.2: Electron's resources folder (app.asar and the licence addon next to it), where the Pro module checks the
   * licence and the app's files for itself.
   */
  resourcesPath?: string;
  /** 1.2: the folders that keep this PC's trial record, as the app's licensing has them (configureLicensing). */
  trialMarkerDirs?: readonly string[];
  /** Protects a secret for this Windows user (DPAPI); throws when Windows can't. The result is safe to store in a file. */
  protectSecret(plain: string): string;
  /** Reads back a secret from protectSecret. */
  revealSecret(stored: string): string;
  log(...args: unknown[]): void;
}
