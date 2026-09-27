import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { ApiReply, apiRoutes, errorResponse, type ApiRequest } from './routes.ts';

export function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _req, reply) => {
    const response = errorResponse(error);
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (response.status === 500 && statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'bad_request', details: error instanceof Error ? error.message : String(error) });
    }
    if (response.status === 500) console.error(error);
    return reply.status(response.status).send(response.body);
  });

  for (const route of apiRoutes(db)) {
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
