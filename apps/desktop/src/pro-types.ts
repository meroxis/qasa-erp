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
}

export interface ProContext {
  db: Db;
  server: FastifyInstance;
  /** The folder with the company data and the app's settings. */
  userDataDir: string;
  appVersion: string;
  /** Serves the app's screens (the built web app) from a server, the way the app's own server does. */
  serveWeb(server: FastifyInstance): void;
  /** The headers every answer of the app carries (content security policy and the like). */
  securityHeaders: Readonly<Record<string, string>>;
  log(...args: unknown[]): void;
}
