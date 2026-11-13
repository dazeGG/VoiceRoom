// The desktop app opens https://voiceroom.ru/; there it is the app, not the
// site. The home page loads this as a blocking script in <head>, so the app's
// window never shows the landing first. A file, not inline: script-src 'self'.
import type { APIRoute } from 'astro';
import { desktopRedirectScript } from '../seo.ts';

export const GET: APIRoute = () =>
  new Response(desktopRedirectScript(), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
