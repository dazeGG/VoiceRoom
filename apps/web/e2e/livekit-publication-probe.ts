import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';

/** Read-only test oracle for the local Playwright LiveKit server. */
export async function getLiveKitMicrophoneMuted(roomName: string, speakerName: string): Promise<boolean | null> {
  const client = new RoomServiceClient(
    'http://127.0.0.1:7880',
    'devkey',
    process.env.PLAYWRIGHT_LIVEKIT_API_SECRET ?? 'devsecret'
  );
  const participants = await client.listParticipants(roomName);
  const matches = participants.filter(
    (participant) => participant.name === speakerName || participant.identity === speakerName
  );
  if (matches.length > 1) throw new Error(`Ambiguous LiveKit speaker: ${speakerName}`);
  const microphones = matches[0]?.tracks.filter((track) => track.source === TrackSource.MICROPHONE) ?? [];
  if (microphones.length > 1) throw new Error(`Ambiguous LiveKit microphone: ${speakerName}`);
  return microphones[0]?.muted ?? null;
}
