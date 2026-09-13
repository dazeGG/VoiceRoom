'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

// Link previews make the server open URLs that chat users chose, so every
// request stays on the public internet: only http(s) on the default ports, no
// credentials in the URL, and every address a host name resolves to must be
// public, on every redirect hop. The socket connects to the vetted address, so
// a second DNS answer cannot swap in an internal host.

const MAX_PAGE_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const BLOCKED_SUBNETS = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) {
  BLOCKED_SUBNETS.addSubnet(address, prefix, 'ipv4');
}
// IPv4-mapped IPv6 (::ffff:0:0/96) is not listed here: BlockList also applies
// such a rule to every plain IPv4 address. Mapped addresses are refused below.
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]) {
  BLOCKED_SUBNETS.addSubnet(address, prefix, 'ipv6');
}

function isPublicAddress(address) {
  const value = String(address || '');
  const family = net.isIP(value);
  if (!family) return false;
  try {
    if (family === 6) {
      // The URL parser writes every spelling of an IPv6 address the same way,
      // so ::ffff:127.0.0.1 and 0:0:0:0:0:ffff:7f00:1 are both caught.
      const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
      if (canonical.startsWith('::ffff:')) return false;
      return !BLOCKED_SUBNETS.check(canonical, 'ipv6');
    }
    return !BLOCKED_SUBNETS.check(value, 'ipv4');
  } catch {
    return false;
  }
}

function fetchError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createLinkPreviewFetcher({
  lookup = dns.lookup,
  isAllowedAddress = isPublicAddress,
  isAllowedPort = (port) => port === 80 || port === 443,
  timeoutMs = 5000,
  maxRedirects = 3,
  userAgent = 'VoiceRoomLinkPreview/1.0 (+https://voiceroom.ru)'
} = {}) {
  function checkedUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw fetchError('unsupported_url', 'Invalid link');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fetchError('unsupported_url', 'Only http and https links are previewed');
    if (url.username || url.password) throw fetchError('unsupported_url', 'Links with credentials are not previewed');
    const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
    if (!isAllowedPort(port)) throw fetchError('unsupported_url', 'Only default ports are previewed');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !isAllowedAddress(host)) throw fetchError('blocked_address', 'The link points to a private address');
    return url;
  }

  function safeLookup(hostname, options, callback) {
    const requested = options && typeof options === 'object' ? options : {};
    lookup(hostname, { ...requested, all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error);
        return;
      }
      const list = Array.isArray(addresses) ? addresses : [];
      // One internal answer taints the whole name: never pick the public one
      // and hope the next resolution agrees.
      if (list.length === 0 || list.some((entry) => !isAllowedAddress(entry.address))) {
        callback(fetchError('blocked_address', 'The link resolves to a private address'));
        return;
      }
      if (requested.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  }

  function requestOnce(url, accept, signal) {
    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const request = client.request(url, {
        method: 'GET',
        agent: false,
        lookup: safeLookup,
        signal,
        headers: { Accept: accept, 'Accept-Language': 'ru,en;q=0.8', 'User-Agent': userAgent }
      }, resolve);
      request.on('error', reject);
      request.end();
    });
  }

  async function readBody(response, maxBytes, truncate) {
    const declared = Number(response.headers['content-length']);
    if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
      response.destroy();
      throw fetchError('too_large', 'The response is too large');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
      const remaining = maxBytes - size;
      if (chunk.length > remaining) {
        if (!truncate) throw fetchError('too_large', 'The response is too large');
        chunks.push(chunk.subarray(0, remaining));
        size = maxBytes;
        break;
      }
      chunks.push(chunk);
      size += chunk.length;
    }
    return Buffer.concat(chunks, size);
  }

  async function fetchResource(rawUrl, { accept, acceptsType, maxBytes, truncate = false }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let url = checkedUrl(rawUrl);
      for (let redirects = 0; ; redirects += 1) {
        const response = await requestOnce(url, accept, controller.signal);
        const status = response.statusCode || 0;
        if (REDIRECT_STATUSES.has(status) && response.headers.location) {
          response.resume();
          if (redirects >= maxRedirects) throw fetchError('too_many_redirects', 'Too many redirects');
          let next;
          try {
            next = new URL(response.headers.location, url).href;
          } catch {
            throw fetchError('unsupported_url', 'Invalid redirect');
          }
          url = checkedUrl(next);
          continue;
        }
        if (status !== 200) {
          response.resume();
          throw fetchError('bad_status', `The site answered ${status}`);
        }
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (!acceptsType(contentType)) {
          response.resume();
          throw fetchError('unsupported_type', 'Unsupported content type');
        }
        const body = await readBody(response, maxBytes, truncate);
        return { url: url.href, contentType, body };
      }
    } catch (error) {
      if (controller.signal.aborted) throw fetchError('timeout', 'The site took too long to answer');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fetchPage: (url) => fetchResource(url, {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      acceptsType: (type) => type.startsWith('text/html') || type.startsWith('application/xhtml+xml'),
      maxBytes: MAX_PAGE_BYTES,
      truncate: true
    }),
    fetchImage: (url) => fetchResource(url, {
      accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.8',
      acceptsType: (type) => /^image\/(jpeg|png|webp|gif)\b/.test(type),
      maxBytes: MAX_IMAGE_BYTES
    })
  };
}

module.exports = { MAX_IMAGE_BYTES, MAX_PAGE_BYTES, createLinkPreviewFetcher, isPublicAddress };
