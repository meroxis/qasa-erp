import type { FastifyInstance } from 'fastify';
import type { Db } from '@qasa/server';

/**
 * The Pro module (office network and other paid features) is developed separately and included only in the
 * official Windows builds. It plugs into the app through this interface; public builds use pro-none.ts instead.
 */
export interface ProModule {
  name: string;
  version: string;
  /** Called once the app's own server is running. */
  start?(ctx: ProContext): Promise<void> | void;
  /** Called before the app quits. */
  stop?(): Promise<void> | void;
}

export interface ProContext {
  db: Db;
  server: FastifyInstance;
  /** The folder with the company data and the app's settings. */
  userDataDir: string;
  log(...args: unknown[]): void;
}
