// Vercel serverless function: ICE servers for WebRTC, including short-lived TURN relay credentials.
// Players behind strict NATs (mobile data, many home routers, school/work networks) cannot connect peer to
// peer with STUN alone; a TURN relay carries their traffic instead. The provider's secret stays here on the
// server; the browser only ever sees credentials that expire.
//
// Configure ONE provider in the Vercel project's environment variables:
//   Cloudflare Realtime TURN : CF_TURN_KEY_ID, CF_TURN_API_TOKEN
//   Metered (metered.ca)     : METERED_DOMAIN (e.g. yourapp.metered.live), METERED_API_KEY
// With neither set, only public STUN is returned (same network / easy NATs still work).
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

async function cloudflare() {
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return null;
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 6 * 3600 }),
  });
  if (!r.ok) throw new Error('cloudflare ' + r.status);
  const j = await r.json();
  return Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
}

async function metered() {
  const domain = process.env.METERED_DOMAIN, key = process.env.METERED_API_KEY;
  if (!domain || !key) return null;
  const r = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error('metered ' + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : j.iceServers || [];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let turn = null, error = null;
  try { turn = (await cloudflare()) || (await metered()); } catch (e) { error = String(e.message || e); }
  res.status(200).json({ iceServers: [...STUN, ...(turn || [])], relay: !!(turn && turn.length), error });
}
