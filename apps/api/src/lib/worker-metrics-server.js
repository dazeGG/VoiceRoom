'use strict';

const http = require('node:http');
const { renderPrometheus } = require('./metrics');

function startWorkerMetricsServer({ host = '0.0.0.0', port = 9464, render = renderPrometheus } = {}) {
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
    response.end(render());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(Object.freeze({
      address: server.address(),
      close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done()))
    })));
  });
}

module.exports = { startWorkerMetricsServer };
