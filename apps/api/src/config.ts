import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  DEMO_MODE: bool.default(false),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(4000),
  PUBLIC_WEB_URL: z.url().default("http://localhost:3000"),
  TRUST_PROXY: bool.default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
  REDIS_URL: z.string().optional(),

  ENCRYPTION_KEY: z.string().min(1),
  COOKIE_SECURE: bool.default(true),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  PRIVILEGED_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(10),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),

  MEMBERSHIP_PROVIDER: z.enum(["registry", "api", "manual"]).default("registry"),
  MEMBERSHIP_API_URL: z.string().optional(),
  MEMBERSHIP_API_KEY: z.string().optional(),

  PAYMENT_PROVIDER: z.enum(["mock", "paystack", "flutterwave"]).default("mock"),
  PAYMENT_ORDER_TTL_MINUTES: z.coerce.number().int().min(10).max(1440).default(60),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_BASE_URL: z.url().default("https://api.paystack.co"),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),
  FLUTTERWAVE_BASE_URL: z.url().default("https://api.flutterwave.com"),
  MOCK_PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["log", "smtp"]).default("log"),
  EMAIL_FROM: z.string().default("DNKI SHARKS Accreditation <no-reply@example.invalid>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool.default(true),

  WORKER_ENABLED: bool.default(true),
  /** Only ever disabled by the automated test suite. Refused outside development. */
  RATE_LIMIT_ENABLED: bool.default(true),
});

export type AppConfig = z.infer<typeof EnvSchema> & { encryptionKey: Buffer; isProduction: boolean };

const PLACEHOLDER = /replace|changeme|placeholder|example/i;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid configuration:\n  ${issues}`);
  }
  const c = parsed.data;
  const encryptionKey = Buffer.from(c.ENCRYPTION_KEY, "base64");
  if (encryptionKey.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  }

  const isProduction = c.APP_ENV === "production";
  const problems: string[] = [];
  if (isProduction || c.APP_ENV === "staging") {
    if (c.DEMO_MODE) problems.push("DEMO_MODE must be false outside development");
    if (!c.COOKIE_SECURE) problems.push("COOKIE_SECURE must be true outside development");
    if (!c.RATE_LIMIT_ENABLED) problems.push("RATE_LIMIT_ENABLED must be true outside development");
    if (PLACEHOLDER.test(c.ENCRYPTION_KEY)) problems.push("ENCRYPTION_KEY looks like a placeholder");
  }
  if (isProduction) {
    if (c.PAYMENT_PROVIDER === "mock") problems.push("PAYMENT_PROVIDER=mock is not allowed in production");
    if (c.EMAIL_PROVIDER === "log") problems.push("EMAIL_PROVIDER=log is not allowed in production");
  }
  if (c.PAYMENT_PROVIDER === "mock" && !c.MOCK_PAYMENT_WEBHOOK_SECRET) {
    problems.push("MOCK_PAYMENT_WEBHOOK_SECRET is required for the sandbox mock provider");
  }
  if (c.PAYMENT_PROVIDER === "paystack" && !c.PAYSTACK_SECRET_KEY) problems.push("PAYSTACK_SECRET_KEY is required");
  if (c.PAYMENT_PROVIDER === "flutterwave" && (!c.FLUTTERWAVE_SECRET_KEY || !c.FLUTTERWAVE_WEBHOOK_HASH)) {
    problems.push("FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH are required");
  }
  if (c.MEMBERSHIP_PROVIDER === "api" && (!c.MEMBERSHIP_API_URL || !c.MEMBERSHIP_API_KEY)) {
    problems.push("MEMBERSHIP_API_URL and MEMBERSHIP_API_KEY are required for the api membership provider");
  }
  if (c.EMAIL_PROVIDER === "smtp" && !c.SMTP_HOST) problems.push("SMTP_HOST is required for EMAIL_PROVIDER=smtp");
  if (problems.length) throw new Error(`Unsafe configuration:\n  ${problems.join("\n  ")}`);

  return { ...c, encryptionKey, isProduction };
}
