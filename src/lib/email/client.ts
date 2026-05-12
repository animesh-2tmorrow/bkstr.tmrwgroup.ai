// Phase 5 Stream E (D15.4) — Nodemailer SMTP client singleton.
//
// Mirrors src/lib/stripe.ts shape (D10.4): lazy-Proxy singleton so
// `next build` doesn't evaluate the transporter at compile time when
// /etc/bkstr/smtp.env hasn't been sourced yet. Construction is deferred to
// first sendInvitationEmail() call, by which time env has been sourced.
//
// Boot-time WARN-on-missing pattern matches stripe.env / oauth.env /
// aws.env / assistant.env (D9.4 / D10.3 / D14.2). The WARNs are non-fatal
// per D15.4 fail-graceful contract — invitation creation succeeds with
// emailSendStatus='failed' + the magic link surfaced in the admin UI as a
// copy-paste fallback. Operator stages /etc/bkstr/smtp.env later; existing
// pending invitations can be resent via the same admin surface (follow-up
// #91) or copy-pasted out-of-band.

import { createTransport, type Transporter } from "nodemailer";

const REQUIRED_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM_NAME",
  "SMTP_FROM_ADDRESS",
] as const;

for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.warn(
      `[smtp] WARN: ${v} missing — invitation emails will fail to send. Stage /etc/bkstr/smtp.env to silence.`,
    );
  }
}

const globalForSmtp = globalThis as unknown as { smtpTransporter?: Transporter };

function makeTransporter(): Transporter {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !port || !user || !pass) {
    throw new Error(
      "SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD not set — stage /etc/bkstr/smtp.env before sending invitations.",
    );
  }
  return createTransport({
    host,
    port,
    // STARTTLS on submission ports (587). Implicit TLS on 465. The
    // canonical bkstr SMTP relay (SES / Mailgun / similar) is port 587 +
    // STARTTLS; if the operator stages a different relay they re-confirm
    // by tailing pm2 logs after the first send.
    secure: port === 465,
    auth: { user, pass },
  });
}

function getTransporter(): Transporter {
  if (!globalForSmtp.smtpTransporter) {
    globalForSmtp.smtpTransporter = makeTransporter();
  }
  return globalForSmtp.smtpTransporter;
}

export type InvitationSendResult =
  | { status: "sent" }
  | { status: "failed"; error: string };

export async function sendInvitationEmail(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<InvitationSendResult> {
  const fromName = process.env.SMTP_FROM_NAME;
  const fromAddress = process.env.SMTP_FROM_ADDRESS;
  if (!fromName || !fromAddress) {
    // Pre-flight: SMTP_FROM_* unset means we can't compose a valid From
    // header. Fail fast with a readable error — the admin UI surfaces
    // this string verbatim so the operator can correlate to the missing
    // env var.
    return {
      status: "failed",
      error: "SMTP_FROM_NAME / SMTP_FROM_ADDRESS not set — stage /etc/bkstr/smtp.env.",
    };
  }
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    return { status: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", error: msg };
  }
}
