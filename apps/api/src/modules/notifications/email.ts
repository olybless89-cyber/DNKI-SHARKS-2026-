import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/pool";

export type OutgoingEmail = { to: string; subject: string; text: string };

export interface EmailSender {
  readonly name: string;
  send(msg: OutgoingEmail): Promise<{ messageId: string | null }>;
}

/**
 * Development adapter. Nothing leaves the machine. In demo mode the message is
 * written to the dev_mailbox table so the sandbox flow can be exercised end to end.
 */
export class LogEmailSender implements EmailSender {
  readonly name = "log";
  constructor(
    private readonly db: Db,
    private readonly writeMailbox: boolean,
  ) {}
  async send(msg: OutgoingEmail) {
    if (this.writeMailbox) {
      await this.db.query("insert into dev_mailbox (recipient, subject, body_text) values ($1, $2, $3)", [
        msg.to,
        msg.subject,
        msg.text,
      ]);
    }
    return { messageId: null };
  }
}

export class SmtpEmailSender implements EmailSender {
  readonly name = "smtp";
  private readonly transport: Transporter;
  constructor(private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT ?? 465,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
  }
  async send(msg: OutgoingEmail) {
    const info = await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
    return { messageId: info.messageId ?? null };
  }
}

export function createEmailSender(config: AppConfig, db: Db): EmailSender {
  if (config.EMAIL_PROVIDER === "smtp") return new SmtpEmailSender(config);
  return new LogEmailSender(db, config.DEMO_MODE && !config.isProduction);
}
