import { createLogger as createUiLogger, type LogLevel } from '@voiceroom/ui/log';
import { getInstalledCallPorts } from './ports';

export { errorContext, type LogContext } from '@voiceroom/ui/log';

// Loggers can be created during import, before the host installs its sink.
export function createLogger(namespace: string): ReturnType<typeof createUiLogger> {
  const fallback = createUiLogger(namespace);
  const logger = () => getInstalledCallPorts()?.diagnostics.logger(namespace) ?? fallback;
  return {
    debug: (msg, ctx) => logger().debug(msg, ctx),
    info: (msg, ctx) => logger().info(msg, ctx),
    warn: (msg, ctx) => logger().warn(msg, ctx),
    error: (msg, ctx) => logger().error(msg, ctx),
    child: (suffix) => createLogger(`${namespace}:${suffix}`)
  };
}

export function reportClientLogs(...args: [reason: string, level?: LogLevel]): Promise<boolean> {
  return getInstalledCallPorts()?.diagnostics.report(...args) ?? Promise.resolve(false);
}
