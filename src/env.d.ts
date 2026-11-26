// Secrets and local-only settings (not in wrangler.jsonc, so `wrangler types` doesn't know them).
interface Env {
  /** Comma-separated emails that are always admins. `wrangler secret put OWNER_EMAILS`. */
  OWNER_EMAILS?: string;
  /** Resend API key (sending access) for notification email. `wrangler secret put RESEND_API_KEY`. */
  RESEND_API_KEY?: string;
  /** Optional Slack incoming-webhook URL for the marketing channel. `wrangler secret put SLACK_WEBHOOK_URL`. */
  SLACK_WEBHOOK_URL?: string;
  /** Local development only (.dev.vars): sign in as this email without Access. */
  DEV_EMAIL?: string;
}
