// Link previews for the to-buy list: GET /api/link-preview?url=... answers {title, image, site} or
// {error}. Node built-ins only. It reads the page's og:title, og:image, og:site_name and <title>
// from the first 256 KB, follows at most two redirects, gives up after 8 seconds, and refuses
// anything that is not http(s) or that points at a private or loopback address, so the route can
// never be used to poke at this machine or its network. No prices or reviews are read: those
// are the manual rows on the item.
import dns from 'node:dns/promises';
import net from 'node:net';

export const MAX_BYTES = 256 * 1024;
export const TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 2;

// Loopback, link-local, RFC 1918, carrier NAT, unspecified, multicast and reserved, in v4 and v6.
export function isPrivateAddress(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === '::1' || low === '::' || /^f[cd]/.test(low) || /^fe[89ab]/.test(low);
  }
  return true;
}

// Why a URL may not be fetched, or null when it may. allowLocal exists for the tests' fixture
// server on 127.0.0.1; the route never passes it.
async function refusal(url, allowLocal) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https links can be previewed.';
  if (url.username || url.password) return 'Links with credentials in them cannot be previewed.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (allowLocal) return null;
  const isPrivate = host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) ? isPrivateAddress(host) : isPrivateAddress((await dns.lookup(host).catch(() => ({ address: '0.0.0.0' }))).address));
  return isPrivate ? 'Private and local addresses cannot be previewed.' : null;
}

async function readHead(body, max) {
  if (!body) return '';
  const chunks = []; let bytes = 0;
  for await (const chunk of body) { chunks.push(chunk); bytes += chunk.length; if (bytes >= max) break; }
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

const decode = text => text.replace(/&(amp|lt|gt|quot|apos|#39|#x27|nbsp);/gi, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", nbsp: ' ' })[name.toLowerCase()]).replace(/\s+/g, ' ').trim();
function attribute(tag, name) { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag); return m ? (m[1] ?? m[2] ?? m[3]) : ''; }
function meta(html, key) {
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const name = attribute(tag, 'property') || attribute(tag, 'name');
    if (name.toLowerCase() === key) { const content = attribute(tag, 'content'); if (content) return decode(content); }
  }
  return '';
}
export function parsePreview(html, url) {
  const title = meta(html, 'og:title') || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  let image = meta(html, 'og:image');
  try { image = image ? new URL(image, url).href : ''; if (image && !/^https?:/.test(image)) image = ''; } catch { image = ''; }
  return { title: title.slice(0, 512), image: image.slice(0, 2048), site: (meta(html, 'og:site_name') || url.hostname).slice(0, 256) };
}

export async function linkPreview(input, { allowLocal = false } = {}) {
  let url;
  try { url = new URL(String(input || '')); } catch { return { error: 'That is not a valid link.' }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      const why = await refusal(url, allowLocal);
      if (why) return { error: why };
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'second-brain-link-preview', Accept: 'text/html' } });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get('location');
        if (!location || hop >= MAX_REDIRECTS) return { error: 'That link redirects too many times.' };
        url = new URL(location, url);
        continue;
      }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return { error: `The page answered HTTP ${res.status}.` }; }
      return parsePreview(await readHead(res.body, MAX_BYTES), url);
    }
  } catch (error) {
    return { error: error?.name === 'AbortError' ? 'The page took longer than 8 seconds to answer.' : 'That page could not be fetched.' };
  } finally { clearTimeout(timer); }
}
