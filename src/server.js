'use strict';

const { loadConfig, ConfigError } = require('./config');
const { createLogger } = require('./logging/logger');
const { createBot } = require('./telegram/bot');
const { createHttpServer } = require('./http/server');
const { version } = require('../package.json');
const { createSupabase } = require('./persistence/supabase');
const { createSupabaseCreditStore, createRepositories } = require('./persistence/repositories');
const { createQueries } = require('./persistence/queries');
const { createCreditBudget } = require('./providers/oddsApi/creditBudget');
const { createAnalysisStore } = require('./persistence/analysisStore');
const { createOddsApiAdapter } = require('./providers/oddsApi');
const { createGeminiExplainer } = require('./explain/gemini');
const { createOnDemandAnalyzer } = require('./pipeline/onDemand');
const { todayReport } = require('./pipeline/today');
const { lineReport } = require('./domain/lineShopping/report');
const { clvMessage } = require('./telegram/lineView');

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
    const repo = createRepositories(db);
    // Provider request log for on-demand odds calls (path only, never the query string with the key).
    const onRequest = (e) => {
      const h = e.headers;
      const num = (n) => (h && h.get(n) !== null && h.get(n) !== '' ? Number(h.get(n)) : null);
      repo
        .insertRequestLog([{ ...e, at: new Date(), creditsLast: num('x-requests-last'), creditsRemaining: num('x-requests-remaining') }])
        .catch((err) => logger.warn('provider.request_log_failed', { error: err && err.message }));
    };
    const odds = config.oddsApiKey ? createOddsApiAdapter({ apiKey: config.oddsApiKey, budget, onRequest }) : null;
    let gemini = null;
    if (config.gemini) {
      try {
        gemini = createGeminiExplainer(config.gemini);
      } catch (err) {
        logger.warn('gemini.unavailable', { error: err && err.message });
      }
    }
    const analysisStore = createAnalysisStore(db);
    const onDemand = createOnDemandAnalyzer({ store: analysisStore, repo, odds, budget, gemini, logger });
    logger.info('analyze.configured', { odds: Boolean(odds), gemini: Boolean(gemini) });
    data = {
      analyze: (text) => onDemand.analyze(text),
      today: (opts) => todayReport({ store: analysisStore }, opts),
      upcoming: (q) => queries.upcoming(q),
      quota: () => queries.quota({ budget }),
      ping: () => queries.ping(),
      latestDigest: () => queries.latestDigest(),
      lastScan: () => queries.lastScan(),
      clv: async () => clvMessage(lineReport(await analysisStore.lineValueCandidates(), { now: new Date() })),
    };
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
    // Updates are acknowledged before processing: let the accepted ones finish.
    server.close(() => server.drain().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  createLogger().error('server.fatal', { error: err && err.message });
  process.exit(1);
});
