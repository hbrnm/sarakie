'use strict';

const { z } = require('zod');

/** Names of variables whose values must never be logged. */
const SECRET_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'FOOTBALL_DATA_ORG_KEY',
  'ODDS_API_KEY',
  'GEMINI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SCHEDULER_TRIGGER_SECRET',
];

const allowedUserIds = z
  .string()
  .trim()
  .min(1, 'must contain at least one numeric Telegram user ID')
  .transform((value, ctx) => {
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
    const ids = [];
    for (const part of parts) {
      if (!/^[1-9]\d{0,15}$/.test(part)) {
        ctx.addIssue({ code: 'custom', message: 'must be a comma-separated list of positive integers' });
        return z.NEVER;
      }
      ids.push(Number(part));
    }
    if (ids.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must contain at least one numeric Telegram user ID' });
      return z.NEVER;
    }
    return new Set(ids);
  });

const optionalSecret = z.string().trim().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(10000),
  TELEGRAM_BOT_TOKEN: z.string().trim().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'must look like a BotFather token'),
  // Telegram allows 1–256 chars of A-Z a-z 0-9 _ - ; we require at least 32 for strength.
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/, 'must be 32–256 chars of A-Z, a-z, 0-9, _ or -'),
  TELEGRAM_ALLOWED_USER_IDS: allowedUserIds,
  // Public base URL used to register the webhook. Render sets RENDER_EXTERNAL_URL automatically.
  WEBHOOK_BASE_URL: z.url({ protocol: /^https$/ }).optional(),
  RENDER_EXTERNAL_URL: z.url({ protocol: /^https$/ }).optional(),
  // Not used in Phase 1; validated only if present.
  FOOTBALL_DATA_ORG_KEY: optionalSecret,
  ODDS_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL_ID: z.string().trim().min(1).optional(),
  SUPABASE_URL: z.url({ protocol: /^https$/ }).optional(),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  SCHEDULER_TRIGGER_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).optional(),
});

class ConfigError extends Error {
  /** @param {{ variable: string, message: string }[]} problems */
  constructor(problems) {
    super(`Invalid configuration: ${problems.map((p) => `${p.variable} (${p.message})`).join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Validates the environment. Never includes variable values in errors.
 * @param {NodeJS.ProcessEnv} env
 */
function loadConfig(env = process.env) {
  // Treat empty strings as unset so optional variables can be left blank.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => ({
      variable: String(issue.path[0] ?? 'unknown'),
      message: issue.code === 'invalid_type' ? 'is required' : issue.message,
    }));
    throw new ConfigError(problems);
  }
  const c = result.data;
  return Object.freeze({
    nodeEnv: c.NODE_ENV,
    port: c.PORT,
    telegram: Object.freeze({
      botToken: c.TELEGRAM_BOT_TOKEN,
      webhookSecret: c.TELEGRAM_WEBHOOK_SECRET,
      allowedUserIds: c.TELEGRAM_ALLOWED_USER_IDS,
      webhookPath: '/telegram/webhook',
    }),
    supabase: c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY ? Object.freeze({ url: c.SUPABASE_URL, serviceRoleKey: c.SUPABASE_SERVICE_ROLE_KEY }) : null,
    publicBaseUrl: (c.WEBHOOK_BASE_URL || c.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '') || null,
    secretValues: SECRET_KEYS.map((k) => cleaned[k]).filter(Boolean),
  });
}

/**
 * Parses TELEGRAM_ALLOWED_USER_IDS for job scripts (same rules as loadConfig).
 * @returns {Set<number>}
 */
function parseAllowedUserIds(value) {
  const r = allowedUserIds.safeParse(value ?? '');
  if (!r.success) throw new ConfigError([{ variable: 'TELEGRAM_ALLOWED_USER_IDS', message: r.error.issues[0].message }]);
  return r.data;
}

module.exports = { loadConfig, parseAllowedUserIds, ConfigError, SECRET_KEYS };
