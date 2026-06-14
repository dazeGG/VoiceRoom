'use strict';

const fs = require('node:fs');
const net = require('node:net');

function startApiListener({
  exit = process.exit,
  host = '127.0.0.1',
  logger = console,
  port = 3000,
  server,
  socketPath = ''
} = {}) {
  if (!server || typeof server.listen !== 'function') {
    throw new TypeError('A server with a listen method is required');
  }

  function logListenAddress(mode, address) {
    if (mode === 'unix') {
      logger.log(`Voice Room API is listening on unix://${address}`);
      return;
    }

    const actual = typeof address === 'object' && address ? address : null;
    const listenHost = actual?.address || host;
    const listenPort = actual?.port || port;
    logger.log(`Voice Room API is listening on http://${listenHost}:${listenPort}`);
  }

  function failToStart(error) {
    logger.error('Voice Room API failed to start:', error);
    if (typeof process !== 'undefined') {
      process.exitCode = 1;
    }
    exit(1);
  }

  function listenOnTcp() {
    const handleTcpError = (error) => {
      server.removeListener('error', handleTcpError);
      failToStart(error);
    };

    server.once('error', handleTcpError);
    server.listen(port, host, () => {
      server.removeListener('error', handleTcpError);
      logListenAddress('tcp', server.address());
    });
  }

  function canConnectToSocket(pathname, callback) {
    let settled = false;
    const client = net.createConnection(pathname);
    const timer = setTimeout(() => finish(false), 250);

    function finish(canConnect) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      callback(canConnect);
    }

    client.once('connect', () => finish(true));
    client.once('error', () => finish(false));
  }

  function listenOnUnix({ retried = false } = {}) {
    const handleSocketError = (error) => {
      server.removeListener('error', handleSocketError);

      if (error?.code === 'EADDRINUSE' && !retried) {
        canConnectToSocket(socketPath, (inUse) => {
          if (inUse) {
            failToStart(error);
            return;
          }

          try {
            fs.unlinkSync(socketPath);
          } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') {
              failToStart(unlinkError);
              return;
            }
          }
          listenOnUnix({ retried: true });
        });
        return;
      }

      if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTSUP')) {
        logger.warn(`Unable to bind unix socket at ${socketPath}: ${error.message}`);
        logger.warn(`Falling back to TCP listen on ${host}:${port}`);
        listenOnTcp();
        return;
      }

      failToStart(error);
    };

    server.once('error', handleSocketError);
    server.listen(socketPath, () => {
      server.removeListener('error', handleSocketError);
      logListenAddress('unix', socketPath);
    });
  }

  if (socketPath) {
    listenOnUnix();
    return;
  }

  listenOnTcp();
}

module.exports = {
  startApiListener
};
