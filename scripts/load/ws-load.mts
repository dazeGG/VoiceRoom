// Load on the API's realtime path, the part `lk load-test` never touches:
// guests create rooms, open /api/ws, join voice, post chat, toggle mute and
// type, while extra lobby sockets watch room previews. Each simulated client
// sends its own X-Forwarded-For so per-IP limits apply as they would to real
// people. With SCREEN_REQUESTS or CAMERA_REQUESTS, that many people in each
// room then ask the media budget for a screen share or a camera, room by
// room, and announce what they were granted. Prints one JSON summary to stdout.
//
// Runs against the stand's API through an SSH tunnel (see README.md):
//   API=http://127.0.0.1:3000 ROOMS=50 PEERS=9 LOBBY=500 DURATION=120 node ws-load.mts

import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const api = process.env.API || 'http://127.0.0.1:3000';
const rooms = Number(process.env.ROOMS || 10);
const peersPerRoom = Number(process.env.PEERS || 9);
const lobbySockets = Number(process.env.LOBBY || 0);
const durationMs = Number(process.env.DURATION || 60) * 1000;
const joinsPerSecond = Number(process.env.JOINS_PER_SECOND || 50);
const chatPerMinute = Number(process.env.CHAT_PER_MIN || 2);
const mutePerMinute = Number(process.env.MUTE_PER_MIN || 2);
const screenRequests = Number(process.env.SCREEN_REQUESTS || 0);
const screenProfile = process.env.SCREEN_PROFILE || 'high-60';
const cameraRequests = Number(process.env.CAMERA_REQUESTS || 0);

type Frame = { id?: string | undefined; type: string; payload?: Record<string, unknown> | undefined };
// This file is copied to the load generator on its own, so it carries its own guard.
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A server frame; null for a message that is not one. */
function readFrame(raw: Buffer): Frame | null {
  const value: unknown = JSON.parse(raw.toString('utf8'));
  if (!isObject(value) || typeof value.type !== 'string') return null;
  return {
    type: value.type,
    id: typeof value.id === 'string' ? value.id : undefined,
    payload: isObject(value.payload) ? value.payload : undefined
  };
}

type Peer = { ws: WebSocket; roomId: string; peerId: string; sessionToken: string; name: string; ip: string };

const counts: Record<string, number> = {};
const joinMs: number[] = [];
const fanoutMs: number[] = [];
const sentAt = new Map<string, number>();
let expectedDeliveries = 0;
const pendingGrants = new Map<string, (payload: Record<string, unknown>) => void>();

const bump = (key: string) => (counts[key] = (counts[key] || 0) + 1);
const token = (bytes: number) => randomBytes(bytes).toString('base64url');
const ipFor = (n: number) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const wsUrl = `${api.replace(/^http/, 'ws')}/api/ws`;

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0);
}

async function post(
  path: string,
  ip: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body)
  });
  const json: unknown = await response.json().catch(() => ({}));
  return { status: response.status, json: isObject(json) ? json : {} };
}

async function createRoom(index: number): Promise<string | null> {
  const { status, json } = await post('/api/rooms', ipFor(index + 1), { name: `lt ${index}` });
  bump(`room_create_${status}`);
  return status === 201 && typeof json.roomId === 'string' ? json.roomId : null;
}

/** Opens a socket and resolves once the server's ready frame arrives. */
function openSocket(ip: string, onFrame: (frame: Frame) => void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: { 'x-forwarded-for': ip } });
    const timer = setTimeout(() => reject(new Error('no ready frame')), 10_000);
    ws.on('message', (raw: Buffer) => {
      const frame = readFrame(raw);
      if (!frame) return;
      if (frame.type === 'ready') {
        clearTimeout(timer);
        resolve(ws);
      }
      onFrame(frame);
    });
    ws.on('close', (code) => {
      clearTimeout(timer);
      bump(`ws_close_${code}`);
      reject(new Error(`closed ${code}`));
    });
    ws.on('error', () => bump('ws_error'));
  });
}

async function joinPeer(roomId: string, index: number): Promise<Peer | null> {
  const ip = ipFor(100_000 + index);
  const peer = { roomId, peerId: `lt-${token(9)}`, sessionToken: token(32), name: `Load ${index}`, ip };
  let joined: (() => void) | null = null;
  let refused: ((reason: string) => void) | null = null;
  const onFrame = (frame: Frame) => {
    const payload = frame.payload || {};
    if (frame.type === 'room.snapshot' && payload.roomId === roomId) joined?.();
    if (['room.full', 'server.full', 'room.not_found', 'error'].includes(frame.type)) refused?.(frame.type);
    if (frame.type === 'room.media.grant' && frame.id) pendingGrants.get(frame.id)?.(payload);
    if (frame.type === 'room.chat.message') {
      const message = payload.message;
      const text = isObject(message) && typeof message.text === 'string' ? message.text : '';
      const sent = sentAt.get(text);
      if (sent !== undefined && !text.includes(peer.peerId)) {
        fanoutMs.push(Date.now() - sent);
        bump('chat_delivered');
      }
    }
  };
  try {
    const ws = await openSocket(ip, onFrame);
    const started = Date.now();
    const outcome = await new Promise<string>((resolve) => {
      joined = () => resolve('joined');
      refused = (reason) => resolve(reason);
      setTimeout(() => resolve('timeout'), 10_000);
      ws.send(JSON.stringify({ type: 'room.join', payload: { ...peer, ip: undefined } }));
    });
    bump(`join_${outcome}`);
    if (outcome !== 'joined') {
      ws.close();
      return null;
    }
    joinMs.push(Date.now() - started);
    return { ws, ...peer };
  } catch {
    bump('join_socket_failed');
    return null;
  }
}

async function openLobbySocket(index: number, roomIds: string[]): Promise<WebSocket | null> {
  try {
    const ws = await openSocket(ipFor(200_000 + index), () => {});
    const roomId = roomIds[index % Math.max(1, roomIds.length)];
    if (roomId) ws.send(JSON.stringify({ type: 'room.preview.subscribe', payload: { roomId } }));
    bump('lobby_open');
    return ws;
  } catch {
    bump('lobby_failed');
    return null;
  }
}

async function chat(peer: Peer, othersInRoom: number) {
  const text = `lt ${peer.peerId} ${token(6)}`;
  // The sender's own id is in the text so its own echo is not counted.
  sentAt.set(text, Date.now());
  expectedDeliveries += othersInRoom;
  const { status } = await post(`/api/rooms/${peer.roomId}/chat`, peer.ip, {
    peerId: peer.peerId,
    sessionToken: peer.sessionToken,
    name: peer.name,
    text
  });
  bump(`chat_post_${status}`);
}

// Asks the media budget, then announces the stream or camera it was granted,
// as the web client does once it publishes.
async function requestMedia(peer: Peer, kind: 'screen' | 'camera') {
  const id = `lt-media-${token(6)}`;
  const { roomId, peerId, sessionToken } = peer;
  const grant = await new Promise<Record<string, unknown> | null>((resolve) => {
    pendingGrants.set(id, resolve);
    setTimeout(() => resolve(null), 10_000);
    const profile = kind === 'screen' ? { profileId: screenProfile } : {};
    peer.ws.send(
      JSON.stringify({ id, type: 'room.media.request', payload: { roomId, peerId, sessionToken, kind, ...profile } })
    );
  });
  pendingGrants.delete(id);
  if (!grant) return bump(`${kind}_no_answer`);
  if (!grant.granted) return bump(`${kind}_refused_${String(grant.reason)}`);
  bump(kind === 'screen' ? `screen_granted_${String(grant.profileId)}` : 'camera_granted');
  const patch = kind === 'screen' ? { screen: true, screenProfileId: grant.profileId } : { camera: true };
  peer.ws.send(JSON.stringify({ type: 'room.peer.update', payload: { roomId, peerId, sessionToken, patch } }));
}

function startActivity(peer: Peer, roomSize: () => number, until: number) {
  let muted = false;
  // A tick every 1.5 s on average, so 40 ticks a minute.
  const tick = async () => {
    while (Date.now() < until) {
      await sleep(1000 + Math.random() * 1000);
      if (Math.random() * 40 < chatPerMinute) {
        peer.ws.send(JSON.stringify({ type: 'room.chat.typing', payload: { roomId: peer.roomId } }));
        await chat(peer, roomSize() - 1).catch(() => bump('chat_post_failed'));
      }
      if (Math.random() * 40 < mutePerMinute) {
        muted = !muted;
        const { roomId, peerId, sessionToken } = peer;
        peer.ws.send(
          JSON.stringify({ type: 'room.peer.update', payload: { roomId, peerId, sessionToken, patch: { muted } } })
        );
        bump('mute_toggle');
      }
    }
  };
  return tick();
}

async function main() {
  const started = Date.now();
  const roomIds = (await Promise.all(Array.from({ length: rooms }, (_, i) => createRoom(i)))).filter(
    (id): id is string => id !== null
  );

  const peers: Peer[] = [];
  const joins: Promise<void>[] = [];
  let index = 0;
  for (const roomId of roomIds) {
    for (let i = 0; i < peersPerRoom; i++) {
      const n = index++;
      joins.push(
        joinPeer(roomId, n).then((peer) => {
          if (peer) peers.push(peer);
        })
      );
      await sleep(1000 / joinsPerSecond);
    }
  }
  const lobby = Array.from({ length: lobbySockets }, (_, i) => openLobbySocket(i, roomIds));
  await Promise.all(joins);
  const lobbyOpen = (await Promise.all(lobby)).filter((ws): ws is WebSocket => ws !== null);
  const joinedAt = Date.now();

  const roomSizes = new Map<string, number>();
  for (const peer of peers) roomSizes.set(peer.roomId, (roomSizes.get(peer.roomId) || 0) + 1);
  for (const roomId of roomIds) {
    const inRoom = peers.filter((peer) => peer.roomId === roomId);
    for (const peer of inRoom.slice(0, screenRequests)) await requestMedia(peer, 'screen');
    for (const peer of inRoom.slice(screenRequests, screenRequests + cameraRequests))
      await requestMedia(peer, 'camera');
  }
  const until = joinedAt + durationMs;
  await Promise.all(peers.map((peer) => startActivity(peer, () => roomSizes.get(peer.roomId) || 1, until)));
  await sleep(3000);

  for (const peer of peers) peer.ws.close();
  for (const ws of lobbyOpen) ws.close();

  console.log(
    JSON.stringify(
      {
        params: {
          rooms,
          peersPerRoom,
          lobbySockets,
          durationS: durationMs / 1000,
          joinsPerSecond,
          chatPerMinute,
          mutePerMinute,
          screenRequests,
          screenProfile,
          cameraRequests
        },
        roomsCreated: roomIds.length,
        peersJoined: peers.length,
        lobbyOpen: lobbyOpen.length,
        rampSeconds: Math.round((joinedAt - started) / 1000),
        joinMs: { p50: percentile(joinMs, 50), p95: percentile(joinMs, 95), p99: percentile(joinMs, 99) },
        chat: {
          deliveredPct: expectedDeliveries
            ? Math.round((1000 * (counts.chat_delivered || 0)) / expectedDeliveries) / 10
            : null,
          fanoutMs: { p50: percentile(fanoutMs, 50), p95: percentile(fanoutMs, 95), p99: percentile(fanoutMs, 99) }
        },
        counts
      },
      null,
      2
    )
  );
  process.exit(0);
}

await main();
