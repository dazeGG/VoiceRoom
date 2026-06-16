// Account auth client. All requests are same-origin, so the HttpOnly session
// cookie set by the API rides along automatically (including on /api/rooms,
// which is how a logged-in user's persistent rooms get an owner).

export interface AuthUser {
  avatarColorKey: string;
  createdAt: number;
  displayName: string;
  id: string;
  login: string;
}

export type RoomRelationship = 'owner' | 'bookmarked';

export interface OwnedRoom {
  createdAt: number;
  emoji: string;
  roomColorKey: string;
  roomIconKey: string;
  roomPresetKey: string;
  emptySince: number | null;
  isStatic: boolean;
  name: string;
  peers: number;
  relationship: RoomRelationship;
  roomId: string;
}

export interface Credentials {
  login: string;
  password: string;
}

export interface RegisterInput extends Credentials {
  displayName?: string;
  passwordConfirm?: string;
}

async function authPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    method: 'POST'
  });

  let payload: { error?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error bodies fall through to the generic message.
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Сервер недоступен');
  }
  return payload as T;
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  const payload = await authPost<{ user: AuthUser }>('/auth/register', input);
  return payload.user;
}

export async function login(input: Credentials): Promise<AuthUser> {
  const payload = await authPost<{ user: AuthUser }>('/auth/login', input);
  return payload.user;
}

export async function logout(): Promise<void> {
  await authPost('/auth/logout', {});
}

export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  const payload = await authPost<{ user: AuthUser }>('/auth/profile', { displayName });
  return payload.user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authPost('/auth/password', { currentPassword, newPassword });
}

export async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/me', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error('Не удалось проверить сессию');
  }
  const payload = (await response.json()) as { user: AuthUser | null };
  return payload.user ?? null;
}

export async function addRoomByCode(code: string): Promise<OwnedRoom> {
  const payload = await authPost<{ room: OwnedRoom }>('/auth/rooms', { code });
  return payload.room;
}

export async function fetchOwnedRooms(): Promise<OwnedRoom[]> {
  const response = await fetch('/api/auth/rooms', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error('Не удалось загрузить комнаты');
  }
  const payload = (await response.json()) as { rooms?: OwnedRoom[] };
  return Array.isArray(payload.rooms) ? payload.rooms : [];
}
