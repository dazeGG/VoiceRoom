import type { APIRoute } from 'astro';
import { sitemapXml } from '../seo.ts';
import { SITEMAP_PAGES } from '../site.ts';

export const GET: APIRoute = () =>
  new Response(sitemapXml(SITEMAP_PAGES), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
