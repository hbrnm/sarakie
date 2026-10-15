'use strict';

const { loadConfig, ConfigError } = require('./config');
const { createLogger } = require('./logging/logger');
const { createBot } = require('./telegram/bot');
const { createHttpServer } = require('./http/server');
const { version } = require('../package.json');
const { createSupabase } = require('./persistence/supabase');
const { createSupabaseCreditStore } = require('./persistence/repositories');
const { createQueries } = require('./persistence/queries');
const { createCreditBudget } = require('./providers/oddsApi/creditBudget');

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      // Variable names and reasons only — never values.
      createLogger().error('config.invalid', { problems: err.problems });
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger({ secrets: config.secretValues });
  const startedAt = Date.now();
  const getStatus = () => ({ version, uptimeSeconds: (Date.now() - startedAt) / 1000, now: new Date() });

  let data = null;
  if (config.supabase) {
    const db = createSupabase(config.supabase);
    const budget = createCreditBudget({ store: createSupabaseCreditStore(db) });
    const queries = createQueries(db);
    data = { upcoming: (q) => queries.upcoming(q), quota: () => queries.quota({ budget }) };
  } else {
    logger.warn('data.unavailable', { reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' });
  }

  const bot = createBot({
    token: config.telegram.botToken,
    allowedUserIds: config.telegram.allowedUserIds,
    logger,
    getStatus,
    data,
  });

  const server = createHttpServer({
    webhookPath: config.telegram.webhookPath,
    webhookSecret: config.telegram.webhookSecret,
    handleUpdate: (update) => bot.handleUpdate(update),
    getStatus,
    logger,
  });

  server.listen(config.port, () => {
    logger.info('server.started', { port: config.port, version, allowedUsers: config.telegram.allowedUserIds.size });
  });

  if (config.publicBaseUrl) {
    const url = `${config.publicBaseUrl}${config.telegram.webhookPath}`;
    try {
      await bot.telegram.setWebhook(url, {
        secret_token: config.telegram.webhookSecret,
        allowed_updates: ['message'],
      });
      logger.info('telegram.webhook_registered', { url });
    } catch (err) {
      logger.error('telegram.webhook_registration_failed', { error: err && err.message });
    }
  } else {
    logger.warn('telegram.webhook_not_registered', { reason: 'no WEBHOOK_BASE_URL or RENDER_EXTERNAL_URL' });
  }

  const shutdown = (signal) => {
    logger.info('server.stopping', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  createLogger().error('server.fatal', { error: err && err.message });
  process.exit(1);
});
