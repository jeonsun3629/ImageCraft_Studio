export default async function handler(req, res) {
  // Basic CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const { key, value, ttlSec } = req.body || {};

    if (!url || !token) {
      return res.status(500).json({ ok: false, message: 'Upstash env not set' });
    }
    if (!key || typeof value === 'undefined') {
      return res.status(400).json({ ok: false, message: 'key and value required' });
    }

    const encodedValue = typeof value === 'string' ? value : JSON.stringify(value);
    const base = `${url}/SET/${encodeURIComponent(key)}/${encodeURIComponent(encodedValue)}`;
    const withTtl = typeof ttlSec === 'number' ? `${base}/EX/${ttlSec}` : base;

    const r = await fetch(withTtl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: data?.error || 'SET failed' });
    }

    return res.json({ ok: true, result: data?.result || 'OK' });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}


