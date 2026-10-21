// A key for an IP address that is stored instead of the address: the same
// address always gives the same key, so the admin panel can tell that two stays
// came from one place, and without the server's secret the key does not give
// the address back. A plain hash would: there are only four billion IPv4
// addresses to try. An IPv6 address is keyed by its /64 network, the part a
// home or phone keeps while it rotates the rest for privacy.

import crypto from 'node:crypto';
import net from 'node:net';

const KEY_HEX_LENGTH = 16;
const STORED_KEY = /^[0-9a-f]{16}$/;

/** Turns an address into its key; null for anything that is not an IP address. */
export type IpKeyOf = (ip: string) => string | null;

/** The eight 16-bit blocks of a valid IPv6 address, as numbers. */
function ipv6Blocks(address: string): number[] {
  let text = address;
  const tail: number[] = [];
  // A dotted IPv4 tail ("64:ff9b::192.0.2.1") is the last two blocks.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    tail.push(((a ?? 0) << 8) | (b ?? 0), ((c ?? 0) << 8) | (d ?? 0));
    text = text.slice(0, dotted.index);
    if (!text.endsWith('::')) text = text.replace(/:$/, '');
  }
  const [head = '', rest] = text.split('::');
  const parse = (part: string) => (part ? part.split(':').map((block) => Number.parseInt(block, 16)) : []);
  const front = parse(head);
  const back = [...parse(rest ?? ''), ...tail];
  const zeros = rest === undefined ? [] : Array<number>(8 - front.length - back.length).fill(0);
  return [...front, ...zeros, ...back];
}

function networkOf(value: string): string {
  const address = value.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const family = net.isIP(address);
  if (family === 4) return address;
  if (family !== 6) return '';
  const prefix = ipv6Blocks(address.split('%')[0] ?? '').slice(0, 4);
  return `${prefix.map((block) => block.toString(16)).join(':')}::/64`;
}

/** Keys addresses with `secret`; null for anything that is not an IP address. */
export function createIpKey(secret: string): IpKeyOf {
  return (ip) => {
    const network = networkOf(ip);
    if (!network) return null;
    return crypto.createHmac('sha256', secret).update(network).digest('hex').slice(0, KEY_HEX_LENGTH);
  };
}

/**
 * What a column that once held addresses stores for `value`: an address
 * becomes its key, a key stays as it is (keying twice changes nothing), and
 * anything else is '' (no address).
 */
export function storedIpKey(ipKeyOf: IpKeyOf, value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (STORED_KEY.test(text)) return text;
  return ipKeyOf(text) ?? '';
}
