import { serve } from '@hono/node-server';
import { bus } from './bus.ts';
import { config } from './config.ts';
import { startImporter } from './importer/index.ts';
import { startPrPoller } from './pr.ts';
import { recover, shutdown } from './queue.ts';
import { app, injectWebSocket } from './server.ts';

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[hubd] listening on http://${config.host}:${info.port} · data in ${config.dataDir}`);
  recover();
  startPrPoller();
  if (process.env.AYNSHQ_IMPORT !== '0') startImporter(() => bus.publish({ type: 'usage.updated' }));
});
injectWebSocket(server);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    shutdown();
    server.close();
    process.exit(0);
  });
}
