/**
 * The parts of the server that also run inside a web browser, for the demo on the website:
 * the same database schema, accounting services and API routes, over an in-browser SQLite.
 */
export { initDatabase, type Db } from './db.ts';
export { seedDemo } from './demo-data.ts';
export { ApiReply, apiRoutes, errorResponse, type ApiRequest, type HttpMethod, type Route } from './routes.ts';
