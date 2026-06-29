export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Сервер недоступен');
  return response.json() as Promise<T>;
}

// Credentialed GET — carries the session cookie, unlike fetchJson (used for
// public room status). The 'same-origin' is explicit to match the mutation
// helpers below.
export async function getJsonAuth<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });

  let payload: { error?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON errors fall through to the generic message.
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Сервер недоступен');
  }

  return payload as T;
}

// Credentialed POST — same template as putJson/del, for session-scoped writes
// (friend requests, direct messages).
export async function postJsonAuth<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  let payload: { error?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON errors are handled by the generic message below.
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Сервер недоступен');
  }

  return payload as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  let payload: { error?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON errors are handled by the generic message below.
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Сервер недоступен');
  }

  return payload as T;
}

// Room mutations carry the session cookie, so they use 'same-origin' (not
// the default 'omit') — same template as authPost (lib/api/auth.ts).
export async function putJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: 'PUT'
  });

  let payload: { error?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON errors are handled by the generic message below.
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Сервер недоступен');
  }

  return payload as T;
}

export async function del<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    method: 'DELETE'
  });

  let payload: { error?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON errors are handled by the generic message below.
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Сервер недоступен');
  }

  return payload as T;
}
