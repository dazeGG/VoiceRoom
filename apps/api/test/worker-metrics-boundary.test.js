'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const metricsPath = require.resolve('../src/lib/metrics');
const serverPath = require.resolve('../src/lib/worker-metrics-server');

function startMetricProcess(kind, ageMs) {
  const code = `const m=require(${JSON.stringify(metricsPath)}),s=require(${JSON.stringify(serverPath)});m[process.env.KIND](Number(process.env.AGE));s.startWorkerMetricsServer({host:'127.0.0.1',port:0}).then(x=>{console.log(x.address.port);process.on('SIGTERM',()=>x.close().then(()=>process.exit()));});`;
  const child = spawn(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '../../..'), env: { ...process.env, KIND: kind, AGE: String(ageMs) }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (chunk) => resolve({ child, port: Number(String(chunk).trim()) }));
  });
}

test('separate worker processes expose independently scrapeable queue ages', async (t) => {
  const notification = await startMetricProcess('recordNotificationOldestPending', 901000);
  const media = await startMetricProcess('recordMediaOldestPending', 902000);
  t.after(() => { notification.child.kill(); media.child.kill(); });
  const notificationText = await (await fetch(`http://127.0.0.1:${notification.port}/metrics`)).text();
  const mediaText = await (await fetch(`http://127.0.0.1:${media.port}/metrics`)).text();
  assert.match(notificationText, /voice_room_notification_oldest_pending_seconds 901/);
  assert.match(notificationText, /voice_room_media_oldest_pending_seconds 0/);
  assert.match(mediaText, /voice_room_media_oldest_pending_seconds 902/);
  assert.match(mediaText, /voice_room_notification_oldest_pending_seconds 0/);
});
