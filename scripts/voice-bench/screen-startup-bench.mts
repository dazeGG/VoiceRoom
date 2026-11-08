// A synthetic screen over an isolated, loopback-only LiveKit SFU. No microphone,
// desktop capture, app accounts or production rooms. See docs/SCREEN_STARTUP.md.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { isArray, isRecord } from '@voice-room/shared/guards';
import { evaluateStartup, loopbackLiveKitUrl, type StartupSample } from './screen-startup-metrics.mts';
import { evaluateSustained, screenEncodingVariant } from './screen-encoding-experiment.mts';

const endpoint = loopbackLiveKitUrl(process.env.SCREEN_BENCH_URL || 'ws://127.0.0.1:17880');
const seconds = Number(process.env.SCREEN_BENCH_SECONDS || 15);
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600) throw new Error('SCREEN_BENCH_SECONDS: 5–600.');
const variant = screenEncodingVariant(process.env.SCREEN_BENCH_VARIANT);
const lowViewerEnabled = process.env.SCREEN_BENCH_LOW_VIEWER === '1';
const output = process.env.RESULTS || join(tmpdir(), `voiceroom-screen-startup-${Date.now()}.json`);
const roomName = `screen-bench-${crypto.randomUUID()}`;
const key = process.env.SCREEN_BENCH_KEY || 'devkey';
const secret = process.env.SCREEN_BENCH_SECRET || 'secret';
const baseline = process.env.SCREEN_BENCH_BASELINE === '1';
const httpEndpoint = new URL(endpoint);
httpEndpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
const rooms = new RoomServiceClient(httpEndpoint.href, key, secret);
const webRoot = fileURLToPath(new URL('../../apps/web', import.meta.url));

// Served as a module by the local Vite instance: imports the app's actual profile
// builder and its installed SDK, rather than a copied benchmark encoding profile.
const browserModule = String.raw`
import { Room, RoomEvent, Track, VideoQuality } from '/src/features/room/client/media/livekit-client.ts';
import { getScreenProfileForMode, getScreenPublishVideoOptions } from '/src/features/room/client/media/profiles.ts';
import { prepareScreenStartBitrate } from '/src/features/room/client/media/screen-start-bitrate.ts';
import { rgbPixelError } from ${JSON.stringify(`/@fs/${fileURLToPath(new URL('./screen-startup-metrics.mts', import.meta.url)).replaceAll('\\', '/')}`)};

import { screenEncodingOptions } from '/@fs/${fileURLToPath(new URL('./screen-encoding-experiment.mts', import.meta.url)).replaceAll('\\', '/')}';
const connections=[];
const signaling=[];
const benchmarkAt=performance.now();
function senderEncodings(pc) {
  return pc.getSenders().filter(sender=>sender.track?.kind==='video').map(sender=>({
    trackId:sender.track.id,degradationPreference:sender.getParameters().degradationPreference ?? null,encodings:sender.getParameters().encodings.map(({rid,active,maxBitrate,maxFramerate,scaleResolutionDownBy})=>({rid,active,maxBitrate,maxFramerate,scaleResolutionDownBy}))
  }));
}
function descriptionSummary(pc,side) {
  const sdp=(side==='local' ? pc.localDescription : pc.remoteDescription)?.sdp || '';
  const sections=sdp.split(/(?=^m=)/m).filter(section=>section.startsWith('m=video')).map(section=>{
    const lines=section.split(/\r?\n/);
    return {
      mid:lines.find(line=>line.startsWith('a=mid:')),
      direction:lines.find(line=>/^a=(sendonly|sendrecv|recvonly|inactive)$/.test(line)),
      msid:lines.filter(line=>line.startsWith('a=msid:')),
      codecs:lines.filter(line=>line.startsWith('a=rtpmap:')),
      startBitrate:lines.filter(line=>line.startsWith('a=fmtp:') && line.includes('x-google-start-bitrate')).map(line=>({payload:line.match(/^a=fmtp:(\d+)/)?.[1],hint:line.match(/x-google-start-bitrate=\d+/)?.[0]}))
    };
  });
  signaling.push({atMs:Math.round(performance.now()-benchmarkAt),side,sections,senders:senderEncodings(pc)});
}
const NativePeerConnection=window.RTCPeerConnection;
window.RTCPeerConnection=class extends NativePeerConnection {
  constructor(...args) { super(...args); connections.push(this); }
  async setLocalDescription(...args) { await super.setLocalDescription(...args); descriptionSummary(this,'local'); }
  async setRemoteDescription(...args) { await super.setRemoteDescription(...args); descriptionSummary(this,'remote'); }
};
const room = new Room({ adaptiveStream: false, dynacast: true });
const video = document.createElement('video');
video.autoplay = true; video.muted = true; video.playsInline = true;
document.body.append(video);
let publication, localTrack, drawing, remoteTrack, audioContext, oscillator, sourceCanvas, referencePixels;
const imageCanvas=document.createElement('canvas'); imageCanvas.width=512; imageCanvas.height=64;
const imageContext=imageCanvas.getContext('2d',{willReadFrequently:true});
let caseAt = performance.now(), previous = new Map(), videoPrevious;
const profile = getScreenProfileForMode('games');
const publishOptions = screenEncodingOptions(await getScreenPublishVideoOptions(profile), ${JSON.stringify(variant)});
room.on(RoomEvent.TrackSubscribed, (track, pub) => {
  if (pub.source !== Track.Source.ScreenShare) return;
  remoteTrack = track;
  track.attach(video);
  video.play().catch(() => {});
});
room.on(RoomEvent.TrackUnsubscribed, track => {
  if (remoteTrack === track) { track.detach(video); remoteTrack = undefined; }
});
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const rate = (stat, field, before) => {
  const now = number(stat[field]), old = number(before?.[field]);
  const elapsed = number(stat.timestamp) - number(before?.timestamp);
  return now !== null && old !== null && now >= old && elapsed > 0 ? (now-old)*1000/elapsed : null;
};
function remotePublication(sid) {
  for (const peer of room.remoteParticipants.values()) for (const pub of peer.trackPublications.values()) {
    if (pub.source === Track.Source.ScreenShare && (!sid || pub.trackSid === sid)) return pub;
  }
}
function reset() { caseAt = performance.now(); previous.clear(); videoPrevious = undefined; }
async function sample(direction) {
  const track = direction === 'send' ? publication?.track : remoteTrack;
  const report = await track?.getRTCStatsReport();
  const entries = report ? Array.from(report.values()) : [];
  const types = direction === 'send' ? 'outbound-rtp' : 'inbound-rtp';
  const streams = entries.filter(s => s.type === types && (s.kind === 'video' || s.mediaType === 'video'));
  streams.sort((a,b) => (b.frameWidth || 0)*(b.frameHeight || 0) - (a.frameWidth || 0)*(a.frameHeight || 0));
  const stat = streams[0], before = stat && previous.get(stat.id);
  const pair = entries.find(s => s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected));
  const codec = entries.find(s => s.id === stat?.codecId);
  const source = entries.find(s => s.id === stat?.mediaSourceId);
  const fps = stat ? rate(stat, direction === 'send' ? 'framesEncoded' : 'framesDecoded', before) : null;
  const bytes = stat ? rate(stat, direction === 'send' ? 'bytesSent' : 'bytesReceived', before) : null;
  const quality = video.getVideoPlaybackQuality?.();
  const videoNow = { frames: quality ? quality.totalVideoFrames - quality.droppedVideoFrames : null, dropped:quality?.droppedVideoFrames, at: performance.now() };
  const renderedFps = quality && videoPrevious && videoNow.frames!==null && videoPrevious.frames!==null && videoNow.frames >= videoPrevious.frames
    ? (videoNow.frames-videoPrevious.frames)*1000/(videoNow.at-videoPrevious.at) : null;
  const droppedFrames=quality && videoPrevious && typeof videoPrevious.dropped==='number' && quality.droppedVideoFrames>=videoPrevious.dropped
    ? quality.droppedVideoFrames-videoPrevious.dropped : null;
  let visual;
  if (direction==='receive' && referencePixels && imageContext && video.videoWidth && video.videoHeight) {
    const sx=video.videoWidth/1280, sy=video.videoHeight/720;
    imageContext.drawImage(video,32*sx,80*sy,512*sx,64*sy,0,0,512,64);
    visual=rgbPixelError(referencePixels,imageContext.getImageData(0,0,512,64).data);
  }
  const result = {
    elapsedMs: Math.round(performance.now()-caseAt), streamId: stat?.id || null, fps,
    width: number(stat?.frameWidth), height: number(stat?.frameHeight), bitrate: bytes === null ? null : bytes*8,
    qualityLimitationReason: stat?.qualityLimitationReason || null,
    availableOutgoingBitrate: number(pair?.availableOutgoingBitrate), encoder: stat?.encoderImplementation || null,
    codec: codec?.mimeType || null, renderedFps: direction === 'receive' ? renderedFps : null,
    droppedFrames:direction==='receive' ? droppedFrames : null, mae:visual?.mae ?? null, psnr:visual?.psnr ?? null,
    captureFps: source ? rate(source, 'frames', previous.get(source.id)) : null,
    layers: streams.map(layer => ({
      id:layer.id,rid:layer.rid ?? null,active:layer.active ?? null,
      width:number(layer.frameWidth),height:number(layer.frameHeight),
      fps:rate(layer,direction==='send'?'framesEncoded':'framesDecoded',previous.get(layer.id)),
      sentFps:direction==='send'?rate(layer,'framesSent',previous.get(layer.id)):null,
      encoder:layer.encoderImplementation ?? null,
      codec:entries.find(entry=>entry.id===layer.codecId)?.mimeType ?? null,
      qualityLimitationReason:layer.qualityLimitationReason ?? null
    })),
    encodeMs: stat ? (() => { const frames=rate(stat,'framesEncoded',before), cost=rate(stat,'totalEncodeTime',before); return frames>0 && cost!==null ? cost*1000/frames : null; })() : null
  };
  previous = new Map(entries.map(s => [s.id,s]));
  videoPrevious = videoNow;
  return result;
}
window.bench = {
  async connect(url,token,withAudio=false) {
    await room.connect(url,token,{autoSubscribe:false});
    if (withAudio) {
      audioContext=new AudioContext(); oscillator=audioContext.createOscillator();
      const destination=audioContext.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start(); await audioContext.resume();
      await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], {
        source:Track.Source.Microphone,audioPreset:{maxBitrate:64000},dtx:false
      });
    }
  },
  async publish() {
    const canvas = document.createElement('canvas'); canvas.width=1280; canvas.height=720; sourceCanvas=canvas;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No canvas context');
    let frame=0;
    const draw=()=> {
      ctx.fillStyle='#152638'; ctx.fillRect(0,0,1280,720);
      for(let i=0;i<45;i++) { ctx.fillStyle='hsl('+((i*19+frame)%360)+' 75% 55%)'; ctx.fillRect((i*83+frame*7)%1280,(i*47+frame*3)%720,65,40); }
      ctx.fillStyle='white'; ctx.font='28px sans-serif'; ctx.fillText('VoiceRoom • 720p30 • frame '+frame,30,55);
      ctx.font='18px monospace'; for(let y=100;y<700;y+=45) ctx.fillText('Readable text 0123456789 — startup clarity and motion',30,y);
      // A fixed reference region remains identical across frames, so motion/latency
      // cannot be mistaken for codec blur in the visual error measurement.
      ctx.fillStyle='#152638'; ctx.fillRect(32,80,512,64);
      ctx.fillStyle='white'; ctx.font='18px monospace'; ctx.fillText('AaBb0123456789 • sharp screen text',40,105);
      for(let x=40;x<530;x+=4) ctx.fillRect(x,116,1,20);
      frame++;
    };
    draw(); drawing=setInterval(draw,1000/30);
    localTrack=canvas.captureStream(30).getVideoTracks()[0]; localTrack.contentHint=profile.contentHint;
    if (!${baseline}) prepareScreenStartBitrate(room.engine.pcManager.publisher,localTrack.id);
    publication=await room.localParticipant.publishTrack(localTrack,screenEncodingOptions(await getScreenPublishVideoOptions(profile),${JSON.stringify(variant)}));
    return publication.trackSid;
  },
  async unpublish() {
    if (publication?.track) await room.localParticipant.unpublishTrack(publication.track,true);
    localTrack?.stop(); clearInterval(drawing); publication=undefined;
  },
  hasPublication: sid => Boolean(remotePublication(sid)),
  begin(sid,low=false) { reset(); const pub=remotePublication(sid); if (!pub) throw new Error('Missing screen publication'); pub.setSubscribed(true); pub.setVideoQuality(low?VideoQuality.LOW:VideoQuality.HIGH); },
  pause(sid) { remotePublication(sid)?.setSubscribed(false); },
  reset, sample,
  reference(pixels) {
    if (pixels) { referencePixels=pixels; return; }
    return Array.from(sourceCanvas.getContext('2d').getImageData(32,80,512,64).data);
  },
  startHints() { return connections.flatMap(pc => (pc.localDescription?.sdp || '').match(/x-google-start-bitrate=\d+/g) || []); },
  signaling() { return {events:signaling,senders:connections.flatMap(senderEncodings)}; },
  async close() { clearInterval(drawing); localTrack?.stop(); oscillator?.stop(); await audioContext?.close(); await room.disconnect(); },
  environment() { return {userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,codecs:RTCRtpSender.getCapabilities('video')?.codecs.map(c=>c.mimeType),profile,requestedVariant:${JSON.stringify(variant)},publishOptions}; }
};
`;

interface BenchSample extends StartupSample {
  bitrate: number | null;
  qualityLimitationReason: string | null;
  availableOutgoingBitrate: number | null;
  encoder: string | null;
  codec: string | null;
  renderedFps: number | null;
  captureFps: number | null;
  encodeMs: number | null;
  droppedFrames: number | null;
  mae: number | null;
  psnr: number | null;
  layers: unknown[];
}

function sampleOf(value: unknown): BenchSample {
  if (!isRecord(value)) throw new Error('Browser returned no sample');
  const numeric = (name: string) =>
    typeof value[name] === 'number' && Number.isFinite(value[name]) ? value[name] : null;
  const string = (name: string) => (typeof value[name] === 'string' ? value[name] : null);
  const elapsedMs = numeric('elapsedMs');
  if (elapsedMs === null) throw new Error('Browser returned no sample timestamp');
  return {
    elapsedMs,
    streamId: string('streamId'),
    fps: numeric('fps'),
    width: numeric('width'),
    height: numeric('height'),
    bitrate: numeric('bitrate'),
    qualityLimitationReason: string('qualityLimitationReason'),
    availableOutgoingBitrate: numeric('availableOutgoingBitrate'),
    encoder: string('encoder'),
    codec: string('codec'),
    renderedFps: numeric('renderedFps'),
    captureFps: numeric('captureFps'),
    encodeMs: numeric('encodeMs'),
    droppedFrames: numeric('droppedFrames'),
    mae: numeric('mae'),
    psnr: numeric('psnr'),
    layers: isArray(value.layers) ? [...value.layers] : []
  };
}

async function token(identity: string): Promise<string> {
  const access = new AccessToken(key, secret, { identity, ttl: '40m' });
  access.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  return access.toJwt();
}

async function call(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(`window.bench[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
}

const vite = await createServer({
  configFile: false,
  root: webRoot,
  logLevel: 'error',
  appType: 'custom',
  resolve: { alias: { '@': join(webRoot, 'src') } },
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  plugins: [
    {
      name: 'screen-startup-bench',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/__screen-bench') {
            response.setHeader('content-type', 'text/html');
            response.end(
              '<!doctype html><html><body><script type="module" src="/__screen-bench.js"></script></body></html>'
            );
          } else if (request.url === '/__screen-bench.js') {
            response.setHeader('content-type', 'text/javascript');
            response.end(browserModule);
          } else next();
        });
      }
    }
  ]
});

let browser: Browser | undefined;
const cases: {
  name: string;
  result: ReturnType<typeof evaluateStartup>;
  sustained: ReturnType<typeof evaluateSustained>;
  sender: BenchSample[];
  receiver: BenchSample[];
  lowReceiver: BenchSample[];
  startHints: unknown;
  signaling: unknown;
}[] = [];
let environment: unknown;
let createdRoom = false;
try {
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port');
  await rooms.createRoom({ name: roomName, emptyTimeout: 30 });
  createdRoom = true;
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const publisher = await browser.newPage();
  const viewer = await browser.newPage();
  const lowViewer = lowViewerEnabled ? await browser.newPage() : undefined;
  for (const page of [publisher, viewer, ...(lowViewer ? [lowViewer] : [])]) {
    page.on('pageerror', (error) => console.error('Benchmark page:', error.message));
    await page.goto(`http://127.0.0.1:${address.port}/__screen-bench`);
    await page.waitForFunction('Boolean(window.bench)', undefined, { timeout: 30_000 });
  }
  await call(publisher, 'connect', endpoint.href, await token('publisher'), true);
  await call(viewer, 'connect', endpoint.href, await token('viewer'));
  if (lowViewer) await call(lowViewer, 'connect', endpoint.href, await token('low-viewer'));
  environment = await call(publisher, 'environment');

  async function measure(name: string, sid: unknown): Promise<void> {
    if (typeof sid !== 'string') throw new Error('Publisher returned no track SID');
    await viewer.waitForFunction(`window.bench.hasPublication(${JSON.stringify(sid)})`, undefined, { timeout: 10_000 });
    if (lowViewer) {
      await lowViewer.waitForFunction(`window.bench.hasPublication(${JSON.stringify(sid)})`, undefined, {
        timeout: 10_000
      });
    }
    await call(viewer, 'reference', await call(publisher, 'reference'));
    await call(publisher, 'reset');
    await call(viewer, 'begin', sid);
    if (lowViewer) {
      await call(lowViewer, 'begin', sid, true);
    }
    const sender: BenchSample[] = [],
      receiver: BenchSample[] = [],
      lowReceiver: BenchSample[] = [];
    // Prime counter deltas; the first sample is never a fabricated 30 FPS.
    await call(publisher, 'sample', 'send');
    await call(viewer, 'sample', 'receive');
    if (lowViewer) await call(lowViewer, 'sample', 'receive');
    for (let second = 0; second < seconds; second++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const [out, incoming, low] = await Promise.all([
        call(publisher, 'sample', 'send'),
        call(viewer, 'sample', 'receive'),
        lowViewer ? call(lowViewer, 'sample', 'receive') : Promise.resolve(undefined)
      ]);
      sender.push(sampleOf(out));
      receiver.push(sampleOf(incoming));
      if (lowViewer) lowReceiver.push(sampleOf(low));
    }
    const result = evaluateStartup(receiver);
    const sustained = evaluateSustained(receiver);
    const startHints = await call(publisher, 'startHints');
    const signaling = await call(publisher, 'signaling');
    cases.push({ name, result, sustained, sender, receiver, lowReceiver, startHints, signaling });
    console.log(JSON.stringify({ name, variant, ...result, sustained }));
  }

  // Exercise a pre-existing audio publisher, not only a brand-new video connection.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  let sid = await call(publisher, 'publish');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await measure('first-share-delayed-viewer', sid);
  await call(viewer, 'pause', sid);
  if (lowViewer) await call(lowViewer, 'pause', sid);
  await new Promise((resolve) => setTimeout(resolve, 7000));
  await measure('dynacast-resume', sid);
  await call(viewer, 'pause', sid);
  if (lowViewer) await call(lowViewer, 'pause', sid);
  await call(publisher, 'unpublish');
  await new Promise((resolve) => setTimeout(resolve, 2000));
  sid = await call(publisher, 'publish');
  await measure('republish-same-connection', sid);
  await Promise.all([
    call(publisher, 'close'),
    call(viewer, 'close'),
    ...(lowViewer ? [call(lowViewer, 'close')] : [])
  ]);
} finally {
  const cleanup = await Promise.all(
    [
      browser?.close(),
      vite.close(),
      createdRoom
        ? rooms.deleteRoom(roomName).catch((error: unknown) => {
            // An empty test room may already have expired after a failed setup.
            if (!isRecord(error) || error.status !== 404) throw error;
          })
        : Promise.resolve()
    ].map(async (task) => {
      try {
        await task;
        return { failed: false, error: undefined };
      } catch (error) {
        return { failed: true, error };
      }
    })
  );
  for (const result of cleanup) {
    if (result.failed) {
      console.error('Benchmark cleanup failed:', result.error);
      process.exitCode = 1;
    }
  }
  writeFileSync(
    output,
    JSON.stringify(
      {
        endpoint: endpoint.origin,
        roomName,
        environment,
        baseline,
        variant,
        lowViewerEnabled,
        limitation:
          'Synthetic loopback/headless Chromium; not the desktop native capture path or a shaped Internet link. Resolution/FPS do not measure visual fidelity.',
        cases
      },
      null,
      2
    )
  );
  console.log(`Results: ${output}`);
}
if (
  cases.length !== 3 ||
  cases.some((result) => result.result.status !== 'pass' || (seconds >= 35 && result.sustained.status !== 'pass'))
)
  process.exitCode = 1;
