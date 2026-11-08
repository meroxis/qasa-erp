/**
 * The parts of the server that also run inside a web browser, for the demo on the website:
 * the same database schema, accounting services and API routes, over an in-browser SQLite.
 */
// first: zod is told not to use eval before any schema below is made (the site CSP has no 'unsafe-eval')
import './zod-jitless.ts';
export { initDatabase, type Db } from './db.ts';
export { seedDemo } from './demo-data.ts';
export { ApiReply, apiRoutes, errorResponse, type ApiRequest, type HttpMethod, type Route } from './routes.ts';
