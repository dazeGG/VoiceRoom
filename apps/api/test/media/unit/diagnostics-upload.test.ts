// The diagnostics file in the media service, the visibility check and the
// message projection, with the repository faked: what a raced or nameless
// upload answers, which parts of the name and type are tolerated, and that an
// opened file is never an image (and an image never a file).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { formatDiagnosticsReport } from '@voiceroom/shared/contracts/diagnostics';
import { DIAGNOSTICS_MAX_BYTES } from '@voiceroom/shared/contracts/media';
import type { Attachment, AttachmentRepository } from '../../../src/domains/media/attachment.repository.ts';
import type { MediaJobRepository } from '../../../src/domains/media/media-job.repository.ts';
import type { MediaPressureService } from '../../../src/domains/media/media-pressure.service.ts';
import type { MediaQuotaService } from '../../../src/domains/media/media-quota.service.ts';
import { createMediaService } from '../../../src/domains/media/media.service.ts';
import {
  createMediaVisibilityService,
  openedMediaHeaders
} from '../../../src/domains/media/media-visibility.service.ts';
import { createMediaStorage } from '../../../src/domains/media/storage.ts';
import { publicAttachment } from '../../../src/domains/messaging/message-projection.ts';
import { attachment, fake, fakeDb } from '../../fakes/index.ts';
import { DIAGNOSTICS_REPORT } from '../../fakes/diagnostics-report.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const NAME = 'voiceroom-diagnostics-2026-11-27-1402.txt';

async function harness(
  t: TestContext,
  {
    ready = true,
    reservedBytes = DIAGNOSTICS_MAX_BYTES,
    beforeRead
  }: { ready?: boolean; reservedBytes?: number | null; beforeRead?: (original: string) => Promise<void> } = {}
) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voice-room-diagnostics-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const original = path.join(root, ID, 'original');
  const storage = createMediaStorage({ rootDir: root });
  const failed: string[] = [];
  const named: string[] = [];
  const draft = attachment({
    id: ID,
    context: 'dm',
    state: 'pending',
    internalState: 'uploading',
    reservedBytes,
    metadata: { kind: 'diagnostics' }
  });
  const service = createMediaService({
    attachmentRepository: fake<AttachmentRepository>({
      findById: async () => draft,
      withAttachmentLock: async (_id, operation) => operation(fakeDb()),
      async markFileReady(id, data) {
        named.push(data.originalName);
        if (!ready) return null;
        return attachment({
          ...draft,
          id,
          state: 'ready',
          internalState: 'ready',
          mimeType: 'text/plain',
          originalBytes: data.bytes,
          width: null,
          height: null,
          metadata: { kind: 'diagnostics', originalName: data.originalName }
        });
      },
      async markFailed(_id, code) {
        failed.push(String(code));
        return null;
      }
    }),
    jobRepository: fake<MediaJobRepository>({ enqueue: async () => fake() }),
    pressureService: fake<MediaPressureService>({ assertAcceptingUploads: async () => fake() }),
    quotaService: fake<MediaQuotaService>(),
    storage: {
      ...storage,
      async openRead(id, variant) {
        await beforeRead?.(original);
        return storage.openRead(id, variant);
      }
    }
  });
  const upload = (input: { mimeType?: string; originalName?: string }, content: string | Buffer = DIAGNOSTICS_REPORT) =>
    service.upload({ id: ID, ownerId: 'owner', stream: Readable.from([Buffer.from(content)]), ...input });
  const stored = () => fs.existsSync(original);
  return { service, upload, failed, named, stored, original };
}

test('the file name may come with a folder and the type with a charset', async (t) => {
  const { upload, named } = await harness(t);
  const accepted = await upload({ mimeType: 'Text/Plain; charset=utf-8', originalName: `C:\\Users\\me\\${NAME}` });
  assert.deepEqual(
    [accepted?.state, accepted?.kind, accepted?.name, accepted?.width],
    ['ready', 'diagnostics', NAME, null]
  );
  assert.deepEqual(named, [NAME]);
});

test('a raw upload without a file name is refused and leaves no file', async (t) => {
  const { upload, failed, stored } = await harness(t);
  await assert.rejects(upload({ mimeType: 'text/plain' }), { code: 'media_diagnostics_invalid', statusCode: 400 });
  assert.deepEqual(failed, ['media_diagnostics_invalid']);
  assert.equal(stored(), false);
});

test('an upload that lost the race to another one answers a conflict and removes its file', async (t) => {
  const { upload, failed, stored } = await harness(t, { ready: false });
  await assert.rejects(upload({ mimeType: 'text/plain', originalName: NAME }), {
    code: 'media_state_conflict',
    statusCode: 409
  });
  assert.deepEqual(failed, ['media_state_conflict']);
  assert.equal(stored(), false);
});

const FILE = { mimeType: 'text/plain', originalName: NAME };
const LOG_DATE = '2026-11-27T14:01:00.000Z';
const LOG_LINE = `${LOG_DATE} info voice join outcome elapsedMs=42 stage=publish outcome=success`;
const REPORT_FIELDS = DIAGNOSTICS_REPORT.slice(0, DIAGNOSTICS_REPORT.indexOf('[Client log]\n'));

function withClientLog(...lines: string[]): string {
  return `${REPORT_FIELDS}[Client log]\n${[...lines, ''].join('\n')}`;
}

test('malformed diagnostics are refused before an attachment becomes ready', async (t) => {
  const badReport = 'The file does not match the VoiceRoom diagnostics format';
  const cases: Array<[string, string | Buffer, string?]> = [
    ['wrong header', DIAGNOSTICS_REPORT.replace('VoiceRoom', 'Other app')],
    ['unsupported version', DIAGNOSTICS_REPORT.replace('diagnostics v1', 'diagnostics v2')],
    ['title only', 'VoiceRoom diagnostics v1'],
    ['missing report timestamp', DIAGNOSTICS_REPORT.replace('2026-11-27T14:02:00.000Z\n', '')],
    ['malformed timestamp', DIAGNOSTICS_REPORT.replace('14:02:00.000Z', '14:02:00Z')],
    ['impossible timestamp', DIAGNOSTICS_REPORT.replace('14:02:00.000Z', '25:02:00.000Z')],
    ['normalized calendar date', DIAGNOSTICS_REPORT.replace('2026-11-27T14:02', '2026-02-30T14:02')],
    ['missing section', DIAGNOSTICS_REPORT.replace('[Room]\nName: [redacted]\nParticipants: 2\n\n', '')],
    ['malformed heading', DIAGNOSTICS_REPORT.replace('[Room]', '[Rooms]')],
    ['missing section separator', DIAGNOSTICS_REPORT.replace('\n\n[Room]', '\n[Room]')],
    ['missing field', DIAGNOSTICS_REPORT.replace('Participants: 2\n', '')],
    ['truncated field list', DIAGNOSTICS_REPORT.slice(0, DIAGNOSTICS_REPORT.indexOf('Participants: 2'))],
    [
      'wrong field order',
      DIAGNOSTICS_REPORT.replace('Name: [redacted]\nParticipants: 2', 'Participants: 2\nName: [redacted]')
    ],
    ['extra field', DIAGNOSTICS_REPORT.replace('Participants: 2', 'Participants: 2\nGuests: 1')],
    ['invalid version field', DIAGNOSTICS_REPORT.replace('Web version: 1.6.0', 'Web version: next')],
    ['unknown browser', DIAGNOSTICS_REPORT.replace('Browser: Firefox 133.0', 'Browser: Custom 1')],
    ['unknown OS', DIAGNOSTICS_REPORT.replace('OS: Linux', 'OS: Other')],
    ['malformed language', DIAGNOSTICS_REPORT.replace('Language: ru-RU', 'Language: ru_RU')],
    ['malformed time zone', DIAGNOSTICS_REPORT.replace('Time zone: Europe/Moscow', 'Time zone: Europe Moscow')],
    ['unredacted room name', DIAGNOSTICS_REPORT.replace('Name: [redacted]', 'Name: Example room')],
    ['invalid participant count', DIAGNOSTICS_REPORT.replace('Participants: 2', 'Participants: -1')],
    ['noncanonical numeric field', DIAGNOSTICS_REPORT.replace('Current RTT (ms): 42', 'Current RTT (ms): 42.0')],
    ['nonfinite numeric field', DIAGNOSTICS_REPORT.replace('Current jitter (ms): 2', 'Current jitter (ms): 1e+309')],
    ['unknown room state', DIAGNOSTICS_REPORT.replace('Room events: connected', 'Room events: offline')],
    ['unknown voice state', DIAGNOSTICS_REPORT.replace('Voice: connected', 'Voice: offline')],
    ['unknown transport', DIAGNOSTICS_REPORT.replace('Transport: udp', 'Transport: http')],
    ['unknown CPU pressure', DIAGNOSTICS_REPORT.replace('Peak: Unavailable', 'Peak: low')],
    ['arbitrary device label', DIAGNOSTICS_REPORT.replace('Microphone: USB device', 'Microphone: My microphone')],
    ['unknown permission state', DIAGNOSTICS_REPORT.replace('permission: granted', 'permission: granted once')],
    ['unknown noise suppression', DIAGNOSTICS_REPORT.replace('Noise suppression: rnnoise', 'Noise suppression: other')],
    ['HTML in a field', DIAGNOSTICS_REPORT.replace('USB device', '<b>USB device</b>')],
    ['control character in a field', DIAGNOSTICS_REPORT.replace('USB device', 'USB\x1bdevice')],
    ['missing log separator', withClientLog(LOG_LINE).replace('\n\n[Client log]', '\n[Client log]')],
    ['wrong log heading', withClientLog(LOG_LINE).replace('[Client log]', '[Logs]')],
    ['missing final newline', withClientLog(LOG_LINE).slice(0, -1)],
    ['extra final newline', withClientLog(LOG_LINE) + '\n'],
    ['empty log', withClientLog()],
    ['too many log entries', withClientLog(...Array<string>(301).fill(LOG_LINE))],
    ['empty log record', withClientLog(LOG_LINE, '')],
    ['missing log level', withClientLog(LOG_DATE)],
    ['invalid log date', withClientLog(LOG_LINE.replace('14:01:00.000Z', '25:01:00.000Z'))],
    ['unknown log level', withClientLog(LOG_LINE.replace(' info ', ' trace '))],
    ['unknown log event', withClientLog(`${LOG_DATE} info user supplied text`)],
    ['markup in an otherwise valid log', withClientLog(LOG_LINE + ' <svg/>')],
    ['unknown event metric', withClientLog(LOG_LINE.replace('elapsedMs', 'otherMs'))],
    ['duplicate event metric', withClientLog(LOG_LINE.replace('elapsedMs=42', 'elapsedMs=42 elapsedMs=43'))],
    ['noncanonical event metric', withClientLog(LOG_LINE.replace('elapsedMs=42', 'elapsedMs=42.0'))],
    ['nonfinite event metric', withClientLog(LOG_LINE.replace('elapsedMs=42', 'elapsedMs=1e+309'))],
    ['unknown join stage', withClientLog(LOG_LINE.replace('stage=publish', 'stage=other'))],
    ['unknown join outcome', withClientLog(LOG_LINE.replace('outcome=success', 'outcome=other'))],
    ['join metadata on a different event', withClientLog(LOG_LINE.replace('voice join outcome', 'call quality'))],
    ['log unavailable mixed with records', withClientLog('Unavailable', LOG_LINE)],
    ['binary bytes in a report', Buffer.concat([Buffer.from(DIAGNOSTICS_REPORT), Buffer.from([0, 1, 2])])],
    ['UTF-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(DIAGNOSTICS_REPORT)])],
    [
      'invalid UTF-8',
      Buffer.concat([Buffer.from(DIAGNOSTICS_REPORT), Buffer.from([0xc3, 0x28])]),
      'The diagnostics file is not UTF-8 text'
    ],
    ['empty file', Buffer.alloc(0), 'The diagnostics file is empty']
  ];

  for (const [label, content, message = badReport] of cases) {
    await t.test(label, async (subtest) => {
      const { upload, failed, named, stored } = await harness(subtest);
      await assert.rejects(upload(FILE, content), { code: 'media_diagnostics_invalid', statusCode: 400, message });
      assert.deepEqual(failed, ['media_diagnostics_invalid']);
      assert.deepEqual(named, []);
      assert.equal(stored(), false);
    });
  }
});

test('an over-limit file is refused even if it grew after storage accepted the upload', async (t) => {
  const { upload, failed, named, stored } = await harness(t, {
    beforeRead: (original) => fs.promises.appendFile(original, Buffer.alloc(DIAGNOSTICS_MAX_BYTES))
  });
  await assert.rejects(upload(FILE), { statusCode: 413, code: 'media_too_large' });
  assert.deepEqual(failed, ['media_too_large']);
  assert.deepEqual(named, []);
  assert.equal(stored(), false);
});

test('diagnostics accept an unavailable log, allowlisted records and up to 300 records', async (t) => {
  const records = [
    `${LOG_DATE} debug joining without a microphone: an earlier microphone operation is unresolved`,
    `${LOG_DATE} info joining without a microphone`,
    `${LOG_DATE} warn voice join outcome`,
    `${LOG_DATE} error voice join outcome stage=started`,
    `Unavailable info voice join outcome outcome=cancel`,
    `${LOG_DATE} Unavailable voice join outcome elapsedMs=0 stage=microphone outcome=failure`,
    `${LOG_DATE} info voice join outcome stage=token outcome=success`,
    `${LOG_DATE} info voice join outcome stage=connect`,
    LOG_LINE,
    `${LOG_DATE} debug call quality durationS=42 peersMax=3 elapsedMs=150 reconnects=0 rttAvgMs=1e-7 rttMaxMs=1e+21 inboundLossAvgPct=0.1 inboundLossMaxPct=0.2 outboundLossAvgPct=0.3 outboundLossMaxPct=0.4 jitterAvgMs=2 jitterMaxMs=4 appCpuAvgPct=-0.5 appCpuMaxPct=12 systemCpuAvgPct=25`,
    `${LOG_DATE} warn server was unreachable`,
    `${LOG_DATE} warn cpu pressure unavailable`,
    `${LOG_DATE} error uncaught error`,
    `${LOG_DATE} error unhandled rejection`,
    `${LOG_DATE} warn call feedback not sent`,
    `${LOG_DATE} warn device list failed`,
    `${LOG_DATE} warn microphone publication failed`,
    `${LOG_DATE} warn microphone track ended`,
    `${LOG_DATE} warn microphone still unavailable`,
    `${LOG_DATE} warn device change handling failed`,
    `${LOG_DATE} warn output device follow failed`,
    `${LOG_DATE} warn device action failed`,
    `${LOG_DATE} info capture_recovery`,
    'Unavailable Unavailable [event details withheld]'
  ];
  const variants = {
    'unavailable log': withClientLog('Unavailable'),
    'allowlisted records': withClientLog(...records),
    '300 records': withClientLog(...Array<string>(300).fill(LOG_LINE))
  };
  for (const [label, report] of Object.entries(variants)) {
    await t.test(label, async (subtest) => {
      const { upload, named, failed, original } = await harness(subtest);
      const accepted = await upload(FILE, report);
      assert.equal(accepted?.state, 'ready');
      assert.equal(accepted.bytes, Buffer.byteLength(report));
      assert.deepEqual(named, [NAME]);
      assert.deepEqual(failed, []);
      assert.equal(await fs.promises.readFile(original, 'utf8'), report);
    });
  }
});

test('diagnostics accept the supported system, connection and device values', async (t) => {
  const fields = [
    ['Browser: Firefox 133.0', ['Edge 132', 'Opera 115', 'Chrome 131', 'Safari 18.3', 'Unavailable']],
    ['OS: Linux', ['Android 15', 'iOS 18.3', 'Windows 11', 'macOS 15.1', 'Unavailable']],
    ['Room events: connected', ['idle', 'connecting', 'reconnecting', 'Unavailable']],
    [
      'Voice: connected',
      [
        'idle',
        'connecting',
        'reconnecting',
        'signal-reconnecting',
        'lost',
        'error',
        'no-route',
        'playback-blocked',
        'Unavailable'
      ]
    ],
    ['Transport: udp', ['tcp', 'relay', 'Unavailable']],
    ['Peak: Unavailable', ['nominal', 'fair', 'serious', 'critical']],
    ['Microphone: USB device', ['Bluetooth device', 'Wireless device', 'Built-in device', 'Unavailable']],
    ['Microphone permission: granted', ['denied', 'prompt', 'Unavailable']],
    ['Noise suppression: rnnoise', ['browser', 'off', 'Unavailable']]
  ] as const;
  const variants = Math.max(...fields.map(([, values]) => values.length));
  for (let index = 0; index < variants; index += 1) {
    let report = DIAGNOSTICS_REPORT;
    for (const [line, values] of fields) {
      const label = line.slice(0, line.indexOf(':'));
      report = report.replace(line, `${label}: ${values[index % values.length]}`);
    }
    const { upload } = await harness(t);
    const result = await upload(FILE, report);
    assert.equal(result?.state, 'ready');
  }
});

test('generated diagnostics can be uploaded with and without client events', async (t) => {
  const date = new Date('2026-11-27T14:02:00.000Z');
  const fields = {
    'Web version': '1.6.0-beta.1',
    'Desktop version': undefined,
    Browser: 'Safari 18.3',
    OS: 'macOS 15.1',
    Language: 'zh-Hant-TW',
    'Time zone': 'Etc/GMT+2',
    Name: 'Private room',
    Participants: 0,
    'Room events': 'reconnecting',
    Voice: 'playback-blocked',
    'Reconnects in last call': 1,
    Transport: 'relay',
    'Current RTT (ms)': 1e-7,
    'Current inbound loss (%)': null,
    'Current outbound loss (%)': Infinity,
    'Current jitter (ms)': -0.25,
    'RTT (ms) average': undefined,
    'RTT (ms) worst': undefined,
    'Inbound loss (%) average': undefined,
    'Inbound loss (%) worst': undefined,
    'Outbound loss (%) average': undefined,
    'Outbound loss (%) worst': undefined,
    'Jitter (ms) average': undefined,
    'Jitter (ms) worst': undefined,
    Peak: 'serious',
    'VoiceRoom average CPU (%)': 10,
    'System average CPU (%)': 12.5,
    Microphone: 'Built-in device',
    Speakers: 'Bluetooth device',
    Camera: 'Wireless device',
    'Microphone permission': 'prompt',
    'Noise suppression': 'off'
  };
  const empty = formatDiagnosticsReport(date, fields, []);
  assert.ok(empty.endsWith('[Client log]\nUnavailable\n'));
  const at = Date.parse(LOG_DATE);
  const logs = formatDiagnosticsReport(date, fields, [
    { at, level: 'info', msg: 'device list failed' },
    {
      at,
      level: 'debug',
      msg: 'voice join outcome',
      ctx: { elapsedMs: 42, stage: 'publish', outcome: 'success', rttAvgMs: NaN }
    },
    { at, level: 'info', msg: 'voice join outcome', ctx: { elapsedMs: '42', stage: 'other', outcome: 'other' } },
    { at: NaN, level: 'trace', msg: 'call quality' },
    { at: Date.UTC(10000, 0), level: 'warn', msg: 'Secret log entry' }
  ]);
  assert.deepEqual(logs.split('[Client log]\n')[1]?.split('\n'), [
    `${LOG_DATE} info device list failed`,
    `${LOG_DATE} debug voice join outcome elapsedMs=42 stage=publish outcome=success`,
    `${LOG_DATE} info voice join outcome`,
    'Unavailable Unavailable call quality',
    'Unavailable warn [event details withheld]',
    ''
  ]);
  assert.match(logs, /Name: Unavailable\nParticipants: 0\n/);
  assert.match(
    logs,
    /Current RTT \(ms\): 1e-7\nCurrent inbound loss \(%\): Unavailable\nCurrent outbound loss \(%\): Unavailable/
  );

  for (const report of [empty, logs]) {
    const { upload } = await harness(t, { reservedBytes: null });
    const accepted = await upload(FILE, report);
    assert.equal(accepted?.state, 'ready');
    assert.equal(accepted.bytes, Buffer.byteLength(report));
  }
});

test('an image slot reports its kind as image, and an unknown kind of slot is refused', async (t) => {
  const { service } = await harness(t);
  await assert.rejects(service.createSlot({ ownerId: 'owner', context: 'dm', clientRequestId: 'r', kind: 'pdf' }), {
    code: 'media_type_unsupported'
  });
  const image = attachment({ id: ID, metadata: { originalName: 'cat.png' } });
  assert.deepEqual(publicAttachment({ ...image, metadata: image.metadata }), {
    id: ID,
    context: 'room',
    order: 0,
    mimeType: 'image/webp',
    bytes: 10,
    width: 10,
    height: 10,
    state: 'ready',
    url: `/api/media/attachments/${ID}/preview`,
    kind: 'image',
    name: null
  });
  // A row without readable metadata is an image too.
  assert.equal(publicAttachment({ ...image, metadata: null }).kind, 'image');
  assert.equal(publicAttachment({ ...image, state: 'processing' }).url, null);
});

function visibility(row: Attachment, opened: { fail?: boolean } = {}) {
  const invariants: string[] = [];
  const service = createMediaVisibilityService({
    attachmentRepository: fake<AttachmentRepository>({ findById: async () => row }),
    authorizeDirectAttachment: async () => true,
    storage: {
      async openRead(_id, variant) {
        if (opened.fail) throw new Error('missing');
        return { key: `${ID}/${String(variant)}`, bytes: 3, stream: Readable.from([Buffer.from(String(variant))]) };
      }
    },
    onAuthorizationInvariantFailure: () => invariants.push('failure')
  });
  return { service, invariants };
}

const file = attachment({
  id: ID,
  context: 'dm',
  mimeType: 'text/plain',
  width: null,
  height: null,
  boundAt: new Date(0),
  directMessageId: 'm1',
  metadata: { kind: 'diagnostics', originalName: NAME }
});

test('a file opens only as itself, as a download that must not be sniffed', async () => {
  const { service } = visibility(file);
  const opened = await service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' });
  assert.deepEqual(openedMediaHeaders(opened, false), {
    'Content-Disposition': `attachment; filename="${NAME}"`,
    'Content-Length': '3',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  for (const variant of ['preview', 'processed', 'original']) {
    await assert.rejects(service.open({ attachmentId: ID, variant, viewerId: 'owner' }), { statusCode: 404 });
  }
  // An image has no file variant.
  const image = visibility(attachment({ id: ID, context: 'dm', boundAt: new Date(0), directMessageId: 'm1' }));
  await assert.rejects(image.service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' }), {
    statusCode: 404
  });
  const preview = await image.service.open({ attachmentId: ID, variant: 'preview', viewerId: 'owner' });
  assert.equal(openedMediaHeaders(preview, true)['Content-Disposition'], 'attachment; filename="image.webp"');
  assert.equal(openedMediaHeaders(preview, false)['Content-Disposition'], 'inline; filename="image.webp"');
});

test('a file without its name, or whose bytes are gone, answers like a missing one', async () => {
  const nameless = visibility(attachment({ ...file, metadata: { kind: 'diagnostics' } }));
  await assert.rejects(nameless.service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' }), {
    statusCode: 404
  });
  assert.deepEqual(nameless.invariants, []);
  const gone = visibility(file, { fail: true });
  await assert.rejects(gone.service.open({ attachmentId: ID, variant: 'file', viewerId: 'owner' }), {
    statusCode: 404
  });
  assert.deepEqual(gone.invariants, ['failure']);
});
