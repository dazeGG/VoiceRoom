// How the admin panel names where someone sat: the system and browser of their
// socket, and the place their address is in, with a short form of the keyed
// hash that stands for the address (equal keys mean the same address).

interface Device {
  client: 'desktop_app' | 'mobile' | 'browser' | null;
  os: string | null;
  browser: string | null;
}

/** "Windows · Chrome"; the desktop app names only its system, since its browser is itself. */
export function deviceLabel({ client, os, browser }: Device): string {
  const parts = client === 'desktop_app' ? [os] : [os, browser];
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/** The first characters of an address key, enough to tell keys apart at a glance. */
export function shortIpKey(ipKey: string | null): string {
  return ipKey ? `ip·${ipKey.slice(0, 6)}` : '';
}

/** The first characters of a guest's browser id. */
export function shortGuestId(guestId: string | null): string {
  return guestId ? `#${guestId.slice(0, 6)}` : '';
}
