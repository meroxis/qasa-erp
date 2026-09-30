import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { ApiReply, apiRoutes, errorResponse, type ApiExtension, type ApiRequest } from './routes.ts';

/**
 * https: the office network serves the same app over TLS with its own certificate (the Pro module).
 * extensions: routes a module adds (the Pro module's), served with the app's own.
 */
export function buildApp(db: Db, options: { https?: { key: string; cert: string }; extensions?: readonly ApiExtension[] } = {}): FastifyInstance {
  const app = (options.https ? Fastify({ logger: false, https: options.https }) : Fastify({ logger: false })) as unknown as FastifyInstance;

  app.setErrorHandler((error, _req, reply) => {
    const response = errorResponse(error);
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (response.status === 500 && statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'bad_request', details: error instanceof Error ? error.message : String(error) });
    }
    if (response.status === 500) console.error(error);
    return reply.status(response.status).send(response.body);
  });

  for (const route of apiRoutes(db, { extensions: options.extensions ?? [] })) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (req, reply) => {
        const out = new ApiReply();
        const request: ApiRequest = { params: req.params, query: req.query, body: req.body, headers: req.headers, secure: req.protocol === 'https' };
        const result = await route.handler(request, out);
        for (const [name, value] of Object.entries(out.headers)) reply.header(name, value);
        return out.sent ? reply.status(out.statusCode).send(out.payload) : result;
      }
    });
  }

  return app;
}
