import { buildApp, createContext } from "./app";
import { loadConfig } from "./config";
import { migrate } from "./db/migrate";
import { startOutboxWorker } from "./modules/notifications/outbox";
import { startReconciliationWorker } from "./modules/payments/service";

const config = loadConfig();
const ctx = createContext(config);
const app = await buildApp(ctx);

if (process.env.MIGRATE_ON_START === "true") {
  await migrate(ctx.db, (m) => app.log.info(m));
}

const stops: (() => void)[] = [];
if (config.WORKER_ENABLED) {
  stops.push(startOutboxWorker(ctx, app.log));
  stops.push(startReconciliationWorker(ctx, app.log));
}

if (config.DEMO_MODE) {
  app.log.warn("DEMO MODE: sandbox adapters are active. Nothing processed by this instance is a real payment or accreditation.");
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  for (const s of stops) s();
  await app.close();
  await ctx.db.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
