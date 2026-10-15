'use strict';

const DISPLAY_TIME_ZONE = 'Europe/Bucharest';

const formatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Formats a UTC instant for display in Europe/Bucharest (persisted values stay UTC).
 * @param {Date} date
 */
function formatForDisplay(date) {
  return `${formatter.format(date)} (ora României)`;
}

module.exports = { formatForDisplay, DISPLAY_TIME_ZONE };
