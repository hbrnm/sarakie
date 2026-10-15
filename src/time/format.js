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

const kickoffFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: DISPLAY_TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Short kickoff label in Europe/Bucharest, e.g. "sâm. 18.10, 17:00". */
function formatKickoff(date) {
  return kickoffFormatter.format(date);
}

const timeFormatter = new Intl.DateTimeFormat('ro-RO', { timeZone: DISPLAY_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });

/** Clock time in Europe/Bucharest, e.g. "11:37". */
function formatTime(date) {
  return timeFormatter.format(date);
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar day in Europe/Bucharest as YYYY-MM-DD (the scanner's `scan_date`). */
function bucharestDate(date) {
  return dateFormatter.format(date);
}

module.exports = { formatForDisplay, formatKickoff, formatTime, bucharestDate, DISPLAY_TIME_ZONE };
