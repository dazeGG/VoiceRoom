import pino, { type DestinationStream } from 'pino';
import { getLogLevel } from '../lib/logger.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { fieldOf } from './record.ts';

const events: ReadonlySet<string> = new Set(Object.values(LOG_EVENTS));

// A parser, upstream or SQL error can contain input in its message or cause.
// Retain only known operational events, including on child request loggers.
export function createPersonalLogger({
  env,
  name,
  destination
}: {
  env: NodeJS.ProcessEnv;
  name: string;
  destination?: DestinationStream;
}) {
  const configured = getLogLevel(env).toLowerCase();
  const level = ['false', 'off', 'none'].includes(configured) ? 'silent' : configured;
  return pino(
    {
      level,
      base: { service: name },
      formatters: { bindings: (bindings) => (fieldOf(bindings, 'service') === name ? { service: name } : {}) },
      hooks: {
        logMethod(args, method) {
          const evt = fieldOf(args[0], 'evt');
          if (typeof evt !== 'string' || !events.has(evt)) return;
          const port = evt === LOG_EVENTS.LISTENING ? fieldOf(args[0], 'port') : undefined;
          method.apply(this, [typeof port === 'number' ? { evt, port } : { evt }]);
        }
      }
    },
    destination
  );
}
