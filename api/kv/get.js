export default async function handler(req, res) {
  // Basic CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const key = req.query?.key;

    if (!url || !token) {
      return res.status(500).json({ ok: false, message: 'Upstash env not set' });
    }
    if (!key) {
      return res.status(400).json({ ok: false, message: 'key required' });
    }

    const r = await fetch(`${url}/GET/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: data?.error || 'GET failed' });
    }

    return res.json({ ok: true, value: data?.result ?? null });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}


