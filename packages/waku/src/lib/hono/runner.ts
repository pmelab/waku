import type { Context, Env, MiddlewareHandler } from 'hono';

import { unstable_getCustomContext } from '../../server.js';
import { resolveConfig } from '../config.js';
import type { HandlerContext, MiddlewareOptions } from '../middleware/types.js';

// Internal context key
const HONO_CONTEXT = '__hono_context';

const createEmptyReadableStream = () =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

// Middleware runner (Is there a better name?)
export const runner = (options: MiddlewareOptions): MiddlewareHandler => {
  const entriesPromise =
    options.cmd === 'start'
      ? options.loadEntries()
      : ('Error: loadEntries are not available' as never);
  const configPromise =
    options.cmd === 'start'
      ? entriesPromise.then((entries) =>
          entries.loadConfig().then((config) => resolveConfig(config)),
        )
      : resolveConfig(options.config);
  const handlersPromise = configPromise.then((config) =>
    Promise.all(
      config
        .middleware()
        .map(async (middleware) => (await middleware).default(options)),
    ),
  );
  return async (c, next) => {
    const ctx: HandlerContext = {
      req: {
        body: c.req.raw.body || createEmptyReadableStream(),
        url: new URL(c.req.url),
        method: c.req.method,
        headers: c.req.header(),
      },
      res: {},
      context: {
        [HONO_CONTEXT]: c,
      },
    };
    const handlers = await handlersPromise;
    const run = async (index: number) => {
      if (index >= handlers.length) {
        return;
      }
      let alreadyCalled = false;
      await handlers[index]!(ctx, async () => {
        if (!alreadyCalled) {
          alreadyCalled = true;
          await run(index + 1);
        }
      });
    };
    await run(0);
    if (ctx.res.body || ctx.res.status) {
      return c.body(
        ctx.res.body || null,
        (ctx.res.status as any) || 200,
        ctx.res.headers || {},
      );
    }
    await next();
  };
};

export const getHonoContext = <E extends Env = Env>() => {
  const c = unstable_getCustomContext()[HONO_CONTEXT];
  if (!c) {
    throw new Error('Hono context is not available');
  }
  return c as Context<E>;
};
