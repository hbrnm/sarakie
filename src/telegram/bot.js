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

  const commands = {
    start: () => messages.startMessage(),
    help: () => messages.helpMessage(),
    health: () => messages.healthMessage(getStatus()),
  };

  // Commands are recognized from the text itself, not only from Telegram's
  // bot_command entity, so "/health" sent as code or pasted text still works.
  bot.on('message', (ctx) => {
    const text = typeof ctx.message.text === 'string' ? ctx.message.text : '';
    const name = parseCommand(text, ctx.botInfo && ctx.botInfo.username);
    const handler = name && Object.hasOwn(commands, name) ? commands[name] : null;
    return ctx.reply(handler ? handler() : messages.unknownMessage());
  });

  bot.catch((err, ctx) => {
    logger.error('telegram.handler_error', { updateType: ctx && ctx.updateType, error: err && err.message });
  });

  return bot;
}

module.exports = { createBot, createAuthMiddleware, parseCommand };
