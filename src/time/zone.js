'use strict';

/**
 * Offset (ms) of `timeZone` from UTC at the given instant, e.g. +3600000 for BST.
 * @param {string} timeZone
 * @param {number} utcMs
 */
function zoneOffsetMs(timeZone, utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC Date.
 * Ambiguous times (clocks going back) resolve to the first occurrence; non-existent
 * times (clocks going forward) are shifted forward by the gap.
 */
function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const HALF_DAY = 12 * 3600 * 1000;
  const offsets = [...new Set([zoneOffsetMs(timeZone, wall - HALF_DAY), zoneOffsetMs(timeZone, wall + HALF_DAY)])];
  const valid = offsets.map((o) => wall - o).filter((utc) => utc + zoneOffsetMs(timeZone, utc) === wall);
  const utc = valid.length ? Math.min(...valid) : wall - zoneOffsetMs(timeZone, wall - HALF_DAY);
  return new Date(utc);
}

module.exports = { zoneOffsetMs, zonedTimeToUtc };
