import type { Connections, Source } from '../types';
let accessToken = '';
export const setAccessToken = (value: string) => { accessToken = value; };
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(115000) });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('The API is not running. Start with npm run dev, or deploy the API on Vercel.');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'The request could not be completed.');
  return json;
}
export const getConnections = () => api<Connections>('status');
export const getSources = () => api<{sources: Source[]}>('sources');

