import { postJson } from './http';
import { createRoomProof } from './pow';

interface CreateRoomResponse {
  roomId: string;
}

export async function createRoom(): Promise<string> {
  const proof = await createRoomProof();
  const room = await postJson<CreateRoomResponse>('/api/rooms', { proof });
  return room.roomId;
}
