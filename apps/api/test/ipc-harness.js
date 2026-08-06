'use strict';

const path = require('node:path');

function socketPathForDirectory(directory) {
  if (process.platform !== 'win32') return path.join(directory, 'api.sock');
  const name = path.basename(directory).replace(/[^a-z0-9._-]/gi, '-');
  return `\\\\.\\pipe\\${name}-${process.pid}`;
}

module.exports = { socketPathForDirectory };
