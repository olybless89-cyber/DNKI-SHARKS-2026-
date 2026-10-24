import type { Permission } from "@dnki/shared";
import type { AppConfig } from "./config";
import type { Db } from "./db/pool";
import type { MembershipVerificationProvider } from "./modules/membership/provider";
import type { EmailSender } from "./modules/notifications/email";
import type { PaymentProvider } from "./modules/payments/provider";

export type AppContext = {
  config: AppConfig;
  db: Db;
  membership: MembershipVerificationProvider;
  payments: PaymentProvider;
  email: EmailSender;
  now: () => Date;
};

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
};

export type AuthState = {
  user: AuthUser;
  sessionId: string;
  mfaVerified: boolean;
  /** MFA is enrolled but not yet completed on this session. */
  mfaPending: boolean;
  roles: string[];
  permissions: Set<Permission>;
  privileged: boolean;
};

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth?: AuthState;
  }
}
