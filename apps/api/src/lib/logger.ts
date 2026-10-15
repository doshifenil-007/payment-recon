// Minimal structured logger: one JSON line per event. Swap for pino later if you want.
type Meta = Record<string, unknown>;

function write(level: 'info' | 'error', msg: string, meta: Meta = {}) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: Meta) => write('info', msg, meta),
  error: (msg: string, meta?: Meta) => write('error', msg, meta),
};
