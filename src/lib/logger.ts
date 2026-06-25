// Minimal structured logger. Lines land in Vercel function logs.

type Fields = Record<string, unknown>;

function emit(level: string, msg: string, fields?: Fields): void {
  const line: Fields = { level, msg, ...(fields ?? {}) };
  // One JSON object per line — greppable in Vercel logs.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export const log = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
};
