'use strict';

/**
 * Structured JSON logger to stdout/stderr. Any known secret value is redacted
 * from the serialized line, wherever it appears.
 * @param {{ secrets?: string[], sink?: { out: (s: string) => void, err: (s: string) => void } }} [options]
 */
function createLogger({ secrets = [], sink } = {}) {
  const out = sink || {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
  const active = secrets.filter((s) => typeof s === 'string' && s.length >= 8);

  function redact(text) {
    let result = text;
    for (const secret of active) result = result.split(secret).join('[REDACTED]');
    return result;
  }

  function write(level, msg, fields = {}) {
    const line = redact(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
    (level === 'error' || level === 'warn' ? out.err : out.out)(line);
  }

  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

module.exports = { createLogger };
