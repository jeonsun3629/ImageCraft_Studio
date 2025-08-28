export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: '인증 토큰이 필요합니다.' });
    }

    const token = authHeader.substring(7);

    // KV에서 사용자 정보 조회
    const kvResponse = await fetch(`${process.env.VERCEL_URL || 'https://image-craft-studio-dk4o.vercel.app'}/api/kv/get?key=${encodeURIComponent(`user_${token}`)}`);
    
    if (!kvResponse.ok) {
      return res.status(401).json({ success: false, error: '유효하지 않은 토큰입니다.' });
    }

    const kvData = await kvResponse.json();
    if (!kvData.ok || !kvData.value) {
      return res.status(401).json({ success: false, error: '유효하지 않은 토큰입니다.' });
    }

    const user = JSON.parse(kvData.value);

    return res.status(200).json({
      success: true,
      user: user
    });

  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ success: false, error: '프로필 조회 중 오류가 발생했습니다.' });
  }
}
