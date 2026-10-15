'use strict';

const { Telegraf } = require('telegraf');
const messages = require('./messages');
const { splitMessage } = require('./send');
const { COMPETITIONS } = require('../domain/competitions');

/**
 * Allowlist middleware. Must be registered first: unauthorized updates get no reply
 * and trigger no further processing. Only private chats are served.
 * @param {Set<number>} allowedUserIds
 * @param {{ info: Function, warn: Function }} logger
 */
function createAuthMiddleware(allowedUserIds, logger) {
  return async (ctx, next) => {
    const userId = ctx.from && ctx.from.id;
    const chatType = ctx.chat && ctx.chat.type;
    const authorized = typeof userId === 'number' && allowedUserIds.has(userId) && chatType === 'private';
    if (!authorized) {
      logger.warn('telegram.unauthorized', {
        telegramUserId: typeof userId === 'number' ? userId : null,
        chatType: chatType || null,
        updateType: ctx.updateType,
      });
      return undefined;
    }
    return next();
  };
}

/**
 * Extracts a lower-case command name from message text: "/health", "/Health@my_bot args".
 * A command addressed to a different bot returns null.
 * @param {string} text
 * @param {string | undefined} botUsername
 */
function parseCommand(text, botUsername) {
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{1,64}))?(?:\s|$)/.exec(text.trim());
  if (!m) return null;
  if (m[2] && (!botUsername || m[2].toLowerCase() !== botUsername.toLowerCase())) return null;
  return m[1].toLowerCase();
}

/**
 * @param {{
 *   token: string,
 *   allowedUserIds: Set<number>,
 *   logger: { info: Function, warn: Function, error: Function },
 *   getStatus: () => { version: string, uptimeSeconds: number, now: Date },
 *   data?: { upcoming: Function, quota: Function, ping?: Function } | null,
 *   now?: () => Date,
 * }} deps
 */
function createBot({ token, allowedUserIds, logger, getStatus, data = null, now = () => new Date() }) {
  const bot = new Telegraf(token);

  bot.use(createAuthMiddleware(allowedUserIds, logger));

  bot.use(async (ctx, next) => {
    const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const command = text.startsWith('/') ? text.split(/\s/)[0].slice(0, 32) : null;
    logger.info('telegram.update', { telegramUserId: ctx.from.id, updateType: ctx.updateType, command });
    return next();
  });

  const DAY = 86400000;

  /** Each command returns one message or an array of messages. */
  const commands = {
    start: () => messages.startMessage(),
    help: () => messages.helpMessage(),
    health: async () => {
      let database = { state: 'not_configured' };
      if (data && data.ping) {
        try {
          database = { state: 'connected', ...(await data.ping()) };
          if (data.lastScan) {
            try {
              database.lastScan = await data.lastScan();
            } catch (err) {
              logger.warn('health.last_scan_failed', { error: err && err.message });
            }
          }
        } catch (err) {
          logger.error('health.database_failed', { error: err && err.message });
          database = { state: 'error' };
        }
      }
      return messages.healthMessage(getStatus(), database);
    },
    fixtures: async (args) => {
      if (!data) return messages.dataUnavailableMessage();
      let code = null;
      if (args[0]) {
        code = messages.parseLeague(args[0]);
        if (!code) return messages.unknownLeagueMessage(args[0]);
      }
      const days = code ? 7 : 3;
      const from = now();
      const items = await data.upcoming({
        from,
        to: new Date(from.getTime() + days * DAY),
        competitionCodes: code ? [code] : COMPETITIONS.map((c) => c.code),
      });
      return messages.fixturesMessages(items, { days, competitionCode: code });
    },
    quota: async () => (data ? messages.quotaMessage(await data.quota()) : messages.dataUnavailableMessage()),
    // D-20: every match of today (or tomorrow) from stored analyses; 0 credits.
    azi: async (args) => {
      if (!data || !data.today) return messages.dataUnavailableMessage();
      const arg = (args[0] || '').toLowerCase();
      if (arg && !['maine', 'mâine', 'miine'].includes(arg)) return 'Folosire: /azi sau /azi maine';
      return splitMessage(await data.today({ tomorrow: Boolean(arg) }));
    },
    // On-demand analysis (Phase 5.3): the full argument text is needed for team names with spaces.
    analyze: async (args, rest) => (data && data.analyze ? splitMessage(await data.analyze(rest)) : messages.dataUnavailableMessage()),
    // Re-sends the latest stored digest; never re-runs the scanner and uses no credits.
    scan: async () => (data && data.latestDigest ? messages.scanMessages(await data.latestDigest()) : messages.dataUnavailableMessage()),
    // Phase 6d: line-shopping paper-test results (stored data only, 0 credits).
    clv: async () => (data && data.clv ? splitMessage(await data.clv()) : messages.dataUnavailableMessage()),
  };

  // Commands are recognized from the text itself, not only from Telegram's
  // bot_command entity, so "/health" sent as code or pasted text still works.
  bot.on('message', async (ctx) => {
    const text = typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const name = parseCommand(text, ctx.botInfo && ctx.botInfo.username);
    const handler = name && Object.hasOwn(commands, name) ? commands[name] : null;
    if (!handler) return ctx.reply(messages.unknownMessage());
    const args = text.trim().split(/\s+/).slice(1, 3).map((a) => a.slice(0, 32));
    const rest = text.trim().replace(/^\S+\s*/, '').slice(0, 120);
    let out;
    try {
      out = await handler(args, rest);
    } catch (err) {
      logger.error('telegram.command_failed', { command: name, error: err && err.message });
      out = messages.dataUnavailableMessage();
    }
    for (const msg of Array.isArray(out) ? out : [out]) await ctx.reply(msg);
    return undefined;
  });

  bot.catch((err, ctx) => {
    logger.error('telegram.handler_error', { updateType: ctx && ctx.updateType, error: err && err.message });
  });

  return bot;
}

module.exports = { createBot, createAuthMiddleware, parseCommand };
