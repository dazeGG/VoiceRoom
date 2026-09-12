#!/usr/bin/env node
// Downloads the free DB-IP City Lite database (CC BY 4.0, https://db-ip.com),
// which the API uses for the city and country in the signed-in devices list.
// DB-IP publishes a new file every month: run this monthly on the server and
// restart the API so it reopens the file.
//
//   node scripts/geoip/fetch-dbip-city-lite.mjs geoip/dbip-city-lite.mmdb
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const MMDB_METADATA_MARKER = Buffer.concat([Buffer.from([0xab, 0xcd, 0xef]), Buffer.from('MaxMind.com')]);
const target = resolve(process.argv[2] || 'geoip/dbip-city-lite.mmdb');

function monthStamp(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function download(stamp) {
  const response = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${stamp}.mmdb.gz`);
  if (!response.ok) return null;
  return gunzipSync(Buffer.from(await response.arrayBuffer()));
}

const now = new Date();
// Early in a month the new file may not be published yet.
const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

let database = null;
for (const stamp of [monthStamp(now), monthStamp(previousMonth)]) {
  database = await download(stamp);
  if (database) {
    console.log(`Downloaded DB-IP City Lite ${stamp}`);
    break;
  }
}

if (!database) {
  console.error('DB-IP City Lite is not available for this month or the previous one');
  process.exit(1);
}
if (!database.includes(MMDB_METADATA_MARKER)) {
  console.error('The downloaded file is not a MaxMind-format database');
  process.exit(1);
}

await mkdir(dirname(target), { recursive: true });
const temporary = `${target}.tmp`;
await writeFile(temporary, database);
await rename(temporary, target);
console.log(`Saved ${database.length} bytes to ${target}`);
