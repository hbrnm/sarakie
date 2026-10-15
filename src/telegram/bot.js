'use strict';

const { Telegraf } = require('telegraf');
const messages = require('./messages');

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
 * @param {{
 *   token: string,
 *   allowedUserIds: Set<number>,
 *   logger: { info: Function, warn: Function, error: Function },
 *   getStatus: () => { version: string, uptimeSeconds: number, now: Date },
 * }} deps
 */
function createBot({ token, allowedUserIds, logger, getStatus }) {
  const bot = new Telegraf(token);

  bot.use(createAuthMiddleware(allowedUserIds, logger));

  bot.use(async (ctx, next) => {
    const text = ctx.message && typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const command = text.startsWith('/') ? text.split(/\s/)[0].slice(0, 32) : null;
    logger.info('telegram.update', { telegramUserId: ctx.from.id, updateType: ctx.updateType, command });
    return next();
  });

  bot.start((ctx) => ctx.reply(messages.startMessage()));
  bot.help((ctx) => ctx.reply(messages.helpMessage()));
  bot.command('health', (ctx) => ctx.reply(messages.healthMessage(getStatus())));
  bot.on('message', (ctx) => ctx.reply(messages.unknownMessage()));

  bot.catch((err, ctx) => {
    logger.error('telegram.handler_error', { updateType: ctx && ctx.updateType, error: err && err.message });
  });

  return bot;
}

module.exports = { createBot, createAuthMiddleware };
