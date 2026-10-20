// Shapes every layer uses, declared once.

/**
 * The pino methods code that only writes log lines calls; take a Pick of what
 * you use. Method syntax keeps both pino and the tests' recording fakes
 * assignable to it.
 */
export type Logger = {
  info(fields: unknown, message?: string, ...args: unknown[]): void;
  warn(fields: unknown, message?: string, ...args: unknown[]): void;
  error(fields: unknown, message?: string, ...args: unknown[]): void;
  fatal(fields: unknown, message?: string, ...args: unknown[]): void;
};

/** A setTimeout handle; fake clocks in tests hand out numbers. */
export type Timer = ReturnType<typeof globalThis.setTimeout> | number;
