import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { Redis } from "ioredis";
import type { AppConfig } from "./config";
import type { AppContext } from "./context";
import { createPool, type Db } from "./db/pool";
import { AppError } from "./lib/errors";
import { accreditationRoutes } from "./modules/accreditation/routes";
import { adminRoutes } from "./modules/admin/routes";
import { authRoutes } from "./modules/auth/routes";
import { eventRoutes } from "./modules/events/routes";
import { createMembershipProvider } from "./modules/membership/provider";
import { membershipRoutes } from "./modules/membership/routes";
import { createEmailSender } from "./modules/notifications/email";
import { FlutterwaveProvider } from "./modules/payments/flutterwave";
import { MockPaymentProvider } from "./modules/payments/mock";
import { PaystackProvider } from "./modules/payments/paystack";
import type { PaymentProvider } from "./modules/payments/provider";
import { paymentRoutes } from "./modules/payments/routes";
import { photoRoutes } from "./modules/photos/routes";
import { registrationRoutes } from "./modules/registration/routes";
import { scanningRoutes } from "./modules/scanning/routes";
import { authHooks } from "./plugins/auth";

export function createPaymentProvider(config: AppConfig, db: Db): PaymentProvider {
  switch (config.PAYMENT_PROVIDER) {
    case "paystack":
      return new PaystackProvider(config);
    case "flutterwave":
      return new FlutterwaveProvider(config);
    default:
      return new MockPaymentProvider(db, config);
  }
}

export function createContext(config: AppConfig, overrides: Partial<AppContext> = {}): AppContext {
  const db = overrides.db ?? createPool(config.DATABASE_URL, config.DATABASE_POOL_MAX);
  return {
    config,
    db,
    membership: overrides.membership ?? createMembershipProvider(config, db),
    payments: overrides.payments ?? createPaymentProvider(config, db),
    email: overrides.email ?? createEmailSender(config, db),
    now: overrides.now ?? (() => new Date()),
  };
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_000_000,
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    logger:
      config.LOG_LEVEL === "silent"
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                "req.headers['x-paystack-signature']",
                "req.headers['verif-hash']",
                "req.headers['x-mock-signature']",
                'res.headers["set-cookie"]',
              ],
              censor: "[redacted]",
            },
          },
  });

  app.decorate("ctx", ctx);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields are invalid.",
          details: err.validation.map((v) => ({
            field: v.instancePath.replace(/^\//, "").replace(/\//g, "."),
            message: v.message,
          })),
          correlationId: req.id,
        },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details, correlationId: req.id },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply
        .code(429)
        .send({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down.", correlationId: req.id } });
    }
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: { code: "BAD_REQUEST", message: "The request could not be processed.", correlationId: req.id } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Quote the reference if you contact support.",
        correlationId: req.id,
      },
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found.", correlationId: req.id } }),
  );

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  await app.register(cookie);
  if (config.RATE_LIMIT_ENABLED)
    await app.register(rateLimit, {
      global: false,
      redis: config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) : undefined,
      skipOnError: false,
      keyGenerator: (req) => req.auth?.user.id ?? req.ip,
    });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "DNKI SHARKS Accreditation API",
        version: "1.0.0",
        description: "Versioned REST API. All state-changing requests require the x-dnki-csrf: 1 header.",
      },
      components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "dnki_session" } } },
    },
    transform: jsonSchemaTransform,
  });
  if (!config.isProduction) {
    await app.register(swaggerUi, { routePrefix: "/api/docs", uiConfig: { docExpansion: "none" } });
  }

  await app.register(authHooks);

  app.get("/health", { schema: { hide: true } }, async () => ({ status: "ok" }));
  app.get("/ready", { schema: { hide: true } }, async (_req, reply) => {
    try {
      await ctx.db.query("select 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  await app.register(
    async (v1) => {
      v1.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
      await v1.register(authRoutes, { prefix: "/auth" });
      await v1.register(eventRoutes);
      await v1.register(membershipRoutes);
      await v1.register(registrationRoutes);
      await v1.register(paymentRoutes);
      await v1.register(accreditationRoutes);
      await v1.register(scanningRoutes);
      await v1.register(photoRoutes);
      await v1.register(adminRoutes);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
