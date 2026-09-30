import type { FastifyInstance } from 'fastify';
import type { Db } from '@qasa/server';

/**
 * The Pro module (office network and other paid features) is developed separately and included only in the
 * official Windows builds. It plugs into the app through this interface; public builds use pro-none.ts instead.
 */
export interface ProModule {
  name: string;
  version: string;
  /** Called before the app's own server starts listening: the only moment it can take more routes. */
  register?(ctx: ProContext): void;
  /** Called once the app's own server is running. */
  start?(ctx: ProContext): Promise<void> | void;
  /** Called before the app quits. */
  stop?(): Promise<void> | void;
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
  /** Windows' folder picker on this PC's window; null when cancelled. */
  chooseFolder(): Promise<string | null>;
  /** Windows' file picker for a backup to restore; null when cancelled. */
  chooseBackupFile(): Promise<string | null>;
  /** Replaces the company file with a checked backup and restarts the app; the current file is kept aside. */
  restoreDatabase(file: string): Promise<void>;
  /** Protects a secret for this Windows user (DPAPI); throws when Windows can't. The result is safe to store in a file. */
  protectSecret(plain: string): string;
  /** Reads back a secret from protectSecret. */
  revealSecret(stored: string): string;
  log(...args: unknown[]): void;
}
