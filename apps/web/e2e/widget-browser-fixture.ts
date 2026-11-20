import { expect, type FrameLocator } from '@playwright/test';

interface WidgetBrowserProbe {
  sockets(): { roster: number; signal: number };
  setOffline(offline: boolean): void;
  cameraUsage(): Promise<{ captures: number; receivedPackets: number }>;
  audioProcessors(): string[];
  inboundAudioPackets(): Promise<number>;
}

declare global {
  interface Window {
    widgetProbe?: WidgetBrowserProbe;
  }
}

export function installWidgetBrowserProbe(): void {
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(window, key, {
      get() {
        throw new DOMException('Storage blocked by fixture', 'SecurityError');
      }
    });
  }
  const sockets: WebSocket[] = [];
  const opened = { roster: 0, signal: 0 };
  let offline = false;
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const path = new URL(url, location.href).pathname;
      const kind = path === '/api/widget/ws' ? 'roster' : path.startsWith('/rtc') ? 'signal' : null;
      if (kind && offline) throw new DOMException('Synthetic connection failure', 'NetworkError');
      super(url, protocols);
      if (!kind) return;
      sockets.push(this);
      this.addEventListener('open', () => opened[kind]++);
    }
  };
  let captures = 0;
  if (navigator.mediaDevices) {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints?.video) captures += 1;
      return getUserMedia(constraints);
    };
  }
  const peers: RTCPeerConnection[] = [];
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      peers.push(this);
    }
  };
  const processors: string[] = [];
  const NativeWorkletNode = window.AudioWorkletNode;
  if (NativeWorkletNode) {
    window.AudioWorkletNode = class extends NativeWorkletNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        processors.push(name);
      }
    };
  }
  async function inboundPackets(kind: 'audio' | 'video') {
    let packets = 0;
    for (const peer of peers.filter(({ connectionState }) => connectionState === 'connected')) {
      (await peer.getStats()).forEach((report: { type: string; kind?: string; packetsReceived?: number }) => {
        if (report.type === 'inbound-rtp' && report.kind === kind) packets += report.packetsReceived ?? 0;
      });
    }
    return packets;
  }
  window.widgetProbe = {
    sockets: () => ({ ...opened }),
    setOffline(value) {
      offline = value;
      if (!value) return;
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.close(4000, 'Synthetic connection failure');
      }
    },
    cameraUsage: async () => ({ captures, receivedPackets: await inboundPackets('video') }),
    audioProcessors: () => [...processors],
    inboundAudioPackets: () => inboundPackets('audio')
  };
}

export async function createWidgetRoom(frame: FrameLocator, name: string): Promise<string> {
  await frame.getByLabel('Ваше имя').fill(name);
  await frame.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('В комнате', { timeout: 30_000 });
  const roomId = await frame.locator('.widget-call__code').textContent();
  if (!roomId) throw new Error('Missing widget room code');
  return roomId;
}

export async function joinWidgetRoom(frame: FrameLocator, roomId: string, name?: string): Promise<void> {
  if (name !== undefined) await frame.getByLabel('Ваше имя').fill(name);
  await frame.getByLabel('Код комнаты').fill(roomId);
  await frame.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('В комнате', { timeout: 30_000 });
}

export async function expectWidgetAudio(frame: FrameLocator) {
  await frame.locator('.widget-shell').hover();
  const enableAudio = frame.getByRole('button', { name: 'Включить звук', exact: true });
  if (await enableAudio.isVisible()) await enableAudio.click();
  const time = () =>
    frame
      .locator('audio')
      .evaluateAll((elements) =>
        Math.max(
          0,
          ...elements.map((element) =>
            element instanceof HTMLAudioElement &&
            !element.paused &&
            element.srcObject instanceof MediaStream &&
            element.srcObject.getAudioTracks().some((track) => track.readyState === 'live')
              ? element.currentTime
              : 0
          )
        )
      );
  const before = await time();
  await expect.poll(time, { timeout: 30_000 }).toBeGreaterThan(before);
  const audioPackets = () => frame.locator('body').evaluate(() => window.widgetProbe?.inboundAudioPackets() ?? 0);
  let previous = await audioPackets();
  await expect
    .poll(
      async () => {
        const current = await audioPackets();
        const delta = current - previous;
        previous = current;
        return delta;
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
}
