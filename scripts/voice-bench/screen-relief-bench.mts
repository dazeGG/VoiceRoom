// Real browser capture/encode/decode, fake camera and oscillator only. This is
// NOT desktop/screen capture, a full app CPU profile, or an Internet benchmark.
import { writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type CDPSession, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { isArray, isRecord } from '@voice-room/shared/guards';
import {
  cpuMillisecondsPerSecond,
  evaluateRelief,
  type CpuSnapshot,
  type ReliefPhase,
  type ReliefSample
} from './screen-relief-metrics.mts';

const seconds = Number(process.env.RELIEF_BENCH_SECONDS || 20);
if (!Number.isInteger(seconds) || seconds < 20 || seconds > 120) throw new Error('RELIEF_BENCH_SECONDS:20–120.');
const output = process.env.RESULTS || join(tmpdir(), `voiceroom-screen-relief-${Date.now()}.json`);
const webRoot = fileURLToPath(new URL('../../apps/web', import.meta.url));
const browserModule = String.raw`
import { createPinia, setActivePinia } from 'pinia';
setActivePinia(createPinia());
const { state } = await import('/src/features/room/client/core/room-runtime.store.ts');
const { applyVideoReliefToScreen } = await import('/src/features/room/client/services/video-relief.ts');
const { getScreenProfile, getScreenPublishVideoOptions } = await import('/src/features/room/client/media/profiles.ts');
const send = new RTCPeerConnection({iceServers:[]}), receive = new RTCPeerConnection({iceServers:[]});
const video = document.createElement('video');
video.autoplay=true; video.muted=true; video.playsInline=true; video.width=1280; video.height=720;
document.body.append(video);
// Keep receiver playout active. The browser process is muted, not this element:
// muting the element can leave Chromium's inbound energy counter at zero.
const audio = document.createElement('audio'); audio.autoplay=true; document.body.append(audio);
receive.ontrack = event => {
  const element=event.track.kind==='video'?video:audio;
  element.srcObject=new MediaStream([event.track]); element.play().catch(()=>{});
};
let capture, context, oscillator, startedAt=0, previous=new Map(), playback;
const num=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
function delta(stat,field) {
  const current=num(stat?.[field]), old=num(previous.get(stat?.id)?.[field]);
  return current!==null&&old!==null&&current>=old?current-old:null;
}
function rate(stat,field) {
  const value=delta(stat,field), elapsed=delta(stat,'timestamp');
  return value!==null&&elapsed>0?value*1000/elapsed:null;
}
async function gathered(pc) {
  if(pc.iceGatheringState==='complete') return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',changed);reject(new Error('ICE gathering timeout'));},10000);
    function changed(){if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',changed);resolve();}}
    pc.addEventListener('icegatheringstatechange',changed); changed();
  });
}
window.bench={
  async start(){
    capture=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{exact:1280},height:{exact:720},frameRate:{ideal:30,max:30}}});
    const track=capture.getVideoTracks()[0]; track.contentHint='motion';
    state.joined=true; state.localScreenStream=capture; state.localScreenProfileId='balanced-30'; state.videoRelieved=false;
    await applyVideoReliefToScreen(capture);
    const options=await getScreenPublishVideoOptions(getScreenProfile('balanced-30'));
    const transceiver=send.addTransceiver(track,{direction:'sendonly',streams:[capture],sendEncodings:[{
      maxBitrate:options.screenShareEncoding.maxBitrate,maxFramerate:30
    }]});
    const codecs=RTCRtpSender.getCapabilities('video').codecs;
    const preferred=codecs.filter(codec=>codec.mimeType.toLowerCase()==='video/'+options.videoCodec);
    transceiver.setCodecPreferences([...preferred,...codecs.filter(codec=>!preferred.includes(codec))]);
    context=new AudioContext(); oscillator=context.createOscillator(); oscillator.frequency.value=440;
    const destination=context.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start(); await context.resume();
    send.addTrack(destination.stream.getAudioTracks()[0],destination.stream);
    await send.setLocalDescription(await send.createOffer()); await gathered(send);
    await receive.setRemoteDescription(send.localDescription);
    await receive.setLocalDescription(await receive.createAnswer()); await gathered(receive);
    await send.setRemoteDescription(receive.localDescription);
    const parameters=transceiver.sender.getParameters();
    parameters.degradationPreference=options.degradationPreference;
    await transceiver.sender.setParameters(parameters);
    return {settings:track.getSettings(),userAgent:navigator.userAgent,selectedCodec:options.videoCodec};
  },
  ready(){return send.connectionState==='connected'&&receive.connectionState==='connected'&&video.videoWidth===1280;},
  async diagnostics(){return {
    sender:{connection:send.connectionState,ice:send.iceConnectionState,gathering:send.iceGatheringState},
    receiver:{connection:receive.connectionState,ice:receive.iceConnectionState,gathering:receive.iceGatheringState},
    video:{width:video.videoWidth,height:video.videoHeight,paused:video.paused,readyState:video.readyState},
    audio:{muted:audio.muted,paused:audio.paused,readyState:audio.readyState,context:context?.state},
    trackId:capture?.getVideoTracks()[0]?.id,settings:capture?.getVideoTracks()[0]?.getSettings(),
    stats:[...Array.from((await send.getStats()).values()),...Array.from((await receive.getStats()).values())]
  };},
  async relieve(){state.videoRelieved=true;await applyVideoReliefToScreen(capture);return capture.getVideoTracks()[0].getSettings();},
  async sample(reset=false){
    const reports=[...Array.from((await send.getStats()).values()),...Array.from((await receive.getStats()).values())];
    const out=reports.find(s=>s.type==='outbound-rtp'&&s.kind==='video');
    const incoming=reports.find(s=>s.type==='inbound-rtp'&&s.kind==='video');
    const voice=reports.find(s=>s.type==='inbound-rtp'&&s.kind==='audio');
    const source=reports.find(s=>s.id===out?.mediaSourceId);
    const codec=reports.find(s=>s.id===out?.codecId);
    const now=performance.now(), quality=video.getVideoPlaybackQuality();
    const shown=quality.totalVideoFrames-quality.droppedVideoFrames;
    if(reset) startedAt=now;
    const result={elapsedMs:now-startedAt,captureFps:rate(source,'frames'),encodedFps:rate(out,'framesEncoded'),
      renderedFps:playback&&now>playback.at?(shown-playback.frames)*1000/(now-playback.at):null,
      width:num(incoming?.frameWidth),height:num(incoming?.frameHeight),audioSamples:delta(voice,'totalSamplesReceived'),
      audioEnergy:delta(voice,'totalAudioEnergy'),concealedSamples:delta(voice,'concealedSamples'),
      encodeMsPerSecond:rate(out,'totalEncodeTime')===null?null:rate(out,'totalEncodeTime')*1000,
      codec:codec?.mimeType??null,encoder:out?.encoderImplementation??null,
      trackId:capture.getVideoTracks()[0].id,settings:capture.getVideoTracks()[0].getSettings(),
      stats:reports.filter(s=>['outbound-rtp','inbound-rtp','media-source','codec','candidate-pair'].includes(s.type))};
    previous=new Map(reports.map(s=>[s.id,s])); playback={at:now,frames:shown}; return result;
  },
  async close(){send.close();receive.close();capture?.getTracks().forEach(track=>track.stop());oscillator?.stop();await context?.close();}
};
`;

function sampleOf(value: unknown): ReliefSample {
  if (!isRecord(value)) throw new Error('Browser returned no sample');
  const numeric = (name: string) =>
    typeof value[name] === 'number' && Number.isFinite(value[name]) ? value[name] : null;
  const text = (name: string) => (typeof value[name] === 'string' ? value[name] : null);
  const elapsedMs = numeric('elapsedMs');
  if (elapsedMs === null) throw new Error('Browser returned no timestamp');
  return {
    elapsedMs,
    captureFps: numeric('captureFps'),
    encodedFps: numeric('encodedFps'),
    renderedFps: numeric('renderedFps'),
    width: numeric('width'),
    height: numeric('height'),
    audioSamples: numeric('audioSamples'),
    audioEnergy: numeric('audioEnergy'),
    concealedSamples: numeric('concealedSamples'),
    encodeMsPerSecond: numeric('encodeMsPerSecond'),
    codec: text('codec'),
    encoder: text('encoder')
  };
}

async function processSnapshot(cdp: CDPSession): Promise<CpuSnapshot> {
  // Protocol: https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/SystemInfo.pdl
  const response: unknown = await cdp.send('SystemInfo.getProcessInfo');
  if (!isRecord(response) || !isArray(response.processInfo)) throw new Error('CDP returned no process metrics');
  const processes = response.processInfo.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'number' ||
      typeof item.type !== 'string' ||
      typeof item.cpuTime !== 'number' ||
      !Number.isFinite(item.cpuTime)
    )
      throw new Error('Invalid CDP process metric');
    return { id: item.id, type: item.type, cpuTime: item.cpuTime };
  });
  return { atMs: performance.now(), processes };
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
      name: 'screen-relief-bench',
      resolveId(id) {
        if (id === '/__relief-bench.js') return '\0screen-relief-bench';
      },
      load(id) {
        if (id === '\0screen-relief-bench') return browserModule;
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== '/__relief-bench') {
            next();
            return;
          }
          response.setHeader('content-type', 'text/html');
          response.end(
            '<!doctype html><html><body><script type="module" src="/__relief-bench.js"></script></body></html>'
          );
        });
      }
    }
  ]
});

let browser: Browser | undefined;
interface RecordedPhase extends ReliefPhase {
  raw: unknown[];
  environment: unknown;
  cpuSnapshots: CpuSnapshot[];
  transitionRaw: unknown;
  startupFailure: string | null;
  failureDiagnostics: unknown;
}
const phases: RecordedPhase[] = [];
let failure: string | undefined;
try {
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port');
  browser = await chromium.launch({
    // Use the installed full Chromium, not the separate headless-shell build:
    // the Windows desktop uses a full browser compositor too.
    executablePath: chromium.executablePath(),
    headless: true,
    args: [
      // Chromium's fake device defaults to 20 FPS, independently of the request.
      '--use-fake-device-for-media-stream=fps=30',
      '--use-fake-ui-for-media-stream',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const cdp = await browser.newBrowserCDPSession();
  for (const relieved of [false, true, true, false]) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
    page.on('pageerror', (error) => console.error('Benchmark page:', error.message));
    const phase: RecordedPhase = {
      relieved,
      samples: [],
      raw: [],
      cpuMsPerSecond: null,
      environment: null,
      transition: null,
      transitionRaw: null,
      cpuSnapshots: [],
      startupFailure: null,
      failureDiagnostics: null
    };
    phases.push(phase);
    try {
      await page.goto(`http://127.0.0.1:${address.port}/__relief-bench`);
      await page.waitForFunction('Boolean(window.bench)', undefined, { timeout: 30_000 });
      phase.environment = await call(page, 'start');
      await page.waitForFunction('window.bench.ready()', undefined, { timeout: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      let transition: ReliefPhase['transition'] = null;
      let transitionRaw: unknown = null;
      if (relieved) {
        const before = await call(page, 'sample', true);
        const settings = await call(page, 'relieve');
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const after = await call(page, 'sample');
        const measured = sampleOf(after);
        transition = {
          sameTrack:
            isRecord(before) &&
            isRecord(after) &&
            typeof before.trackId === 'string' &&
            before.trackId === after.trackId,
          audioSamples: measured.audioSamples,
          audioEnergy: measured.audioEnergy,
          concealedSamples: measured.concealedSamples
        };
        transitionRaw = { before, settings, after };
      }
      await call(page, 'sample', true);
      const before = await processSnapshot(cdp);
      phase.transition = transition;
      phase.transitionRaw = transitionRaw;
      phase.cpuSnapshots.push(before);
      for (let second = 0; second < seconds; second++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const raw = await call(page, 'sample');
        phase.raw.push(raw);
        phase.samples.push(sampleOf(raw));
      }
      const after = await processSnapshot(cdp);
      phase.cpuSnapshots.push(after);
      phase.cpuMsPerSecond = cpuMillisecondsPerSecond(before, after);
      console.log(JSON.stringify({ phase: phases.length, relieved, cpuMsPerSecond: phase.cpuMsPerSecond }));
    } catch (error) {
      phase.startupFailure = error instanceof Error ? error.message : String(error);
      phase.failureDiagnostics = await call(page, 'diagnostics').catch((diagnosticError: unknown) => ({
        unavailable: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
      }));
      throw error;
    } finally {
      await call(page, 'close').catch(() => {});
      await page.close();
    }
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([browser?.close(), vite.close()]);
  const cleanupFailures = cleanup
    .filter((result) => result.status === 'rejected')
    .map((result: { reason: unknown }) => String(result.reason));
  if (cleanupFailures.length) process.exitCode = 1;
  const gate = evaluateRelief(phases);
  writeFileSync(
    output,
    JSON.stringify(
      {
        limitation:
          'Synthetic camera stand-in, single video encoding and oscillator over a same-page peer pair. Not actual screen/native capture, full app, low-end hardware or shaped Internet. CPU is all browser processes (sender AND receiver), excludes Node and native helpers. A missing/churned process counter is unknown, not zero.',
        cpuUnits:
          'CPU milliseconds per wall second across all browser processes; divide by 10 for percent of one logical core.',
        logicalCpus: cpus().length,
        seconds,
        gate,
        failure,
        cleanupFailures,
        phases
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ output, gate, failure }));
  if (gate.workAndVoice !== 'pass') process.exitCode = 1;
}
