import { Room, RoomEvent, Track } from 'livekit-client';
import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import { WidgetRoomCreated } from '@voiceroom/shared/contracts/widget';
import { widgetRequest } from '../../widget/src/http';
import { widgetProof } from '../../widget/src/proof';

/** Test-only malicious client: widens local SDK checks, never its signed token. */
export async function runWidgetBoundaryProbe() {
  const proof = await widgetProof();
  const created = await widgetRequest('/api/widget/rooms', WidgetRoomCreated, {
    chat: false,
    ...(proof ? { proof } : {})
  });
  const sockets: WebSocket[] = [];
  const rooms: Room[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const streams: MediaStream[] = [];
  async function guest() {
    const peerId = crypto.randomUUID();
    const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const target = { roomId: created.roomId, peerId, sessionToken };
    const url = new URL('/api/widget/ws', location.href);
    url.protocol = 'wss:';
    const socket = new WebSocket(url);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Widget probe join timeout')), 15000);
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            type: 'room.join',
            payload: {
              ...target,
              name: 'Boundary fixture',
              guestId: crypto.randomUUID(),
              clientId: crypto.randomUUID()
            }
          })
        );
      socket.onmessage = (event: MessageEvent<string>) => {
        const value: unknown = JSON.parse(event.data);
        if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'room.snapshot') {
          clearTimeout(timeout);
          resolve();
        }
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Widget probe socket failed'));
      };
    });
    timers.push(
      setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'ping', payload: { at: Date.now() } }));
      }, 15000)
    );
    const admission = await widgetRequest('/api/widget/livekit-token', LiveKitAdmission, target);
    const room = new Room();
    rooms.push(room);
    await room.connect(admission.url, admission.token);
    return room;
  }
  try {
    const publisher = await guest();
    const observer = await guest();
    let dataReceived = 0;
    let forbiddenTracksReceived = 0;
    observer.on(RoomEvent.DataReceived, () => dataReceived++);
    observer.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio)
        forbiddenTracksReceived++;
    });
    const permissions = publisher.localParticipant.permissions;
    if (!permissions) throw new Error('Missing SFU permissions');
    permissions.canPublishSources = [];
    permissions.canPublishData = true;
    const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
    streams.push(audio);
    const video = await navigator.mediaDevices.getUserMedia({ video: true });
    streams.push(video);
    const audioTrack = audio.getAudioTracks()[0];
    const videoTrack = video.getVideoTracks()[0];
    if (!audioTrack || !videoTrack) throw new Error('Missing fixture media');
    let screenRejected = false;
    let screenAudioRejected = false;
    try {
      await publisher.localParticipant.publishTrack(videoTrack, { source: Track.Source.ScreenShare });
    } catch {
      screenRejected = true;
    }
    try {
      await publisher.localParticipant.publishTrack(audioTrack, { source: Track.Source.ScreenShareAudio });
    } catch {
      screenAudioRejected = true;
    }
    await publisher.localParticipant.publishData(new TextEncoder().encode('forbidden-widget-data'), { reliable: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { roomId: created.roomId, screenRejected, screenAudioRejected, forbiddenTracksReceived, dataReceived };
  } catch (error) {
    return { roomId: created.roomId, error: error instanceof Error ? error.message : 'Widget boundary probe failed' };
  } finally {
    timers.forEach(clearInterval);
    sockets.forEach((socket) => socket.close());
    await Promise.all(rooms.map((room) => room.disconnect()));
    streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
  }
}
