'use strict';

/** Normalization bookkeeping: invalid provider records are dropped and counted, never passed on. */
function createReport() {
  const report = { received: 0, accepted: 0, dropped: {} };
  return {
    received(n = 1) {
      report.received += n;
    },
    accept() {
      report.accepted += 1;
    },
    drop(reason) {
      report.dropped[reason] = (report.dropped[reason] || 0) + 1;
    },
    value() {
      return { ...report, dropped: { ...report.dropped } };
    },
  };
}

module.exports = { createReport };
