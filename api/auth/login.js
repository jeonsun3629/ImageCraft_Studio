export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: '유효한 이메일 주소가 필요합니다.' });
    }

    // 간단한 토큰 생성 (실제로는 JWT 사용 권장)
    const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 사용자 정보 (실제로는 데이터베이스에 저장)
    const user = {
      email: email,
      credits: 3, // 기본 3크레딧
      createdAt: new Date().toISOString()
    };

    // 토큰을 KV에 저장 (24시간 유효)
    const kvResponse = await fetch(`${process.env.VERCEL_URL || 'https://image-craft-studio-dk4o.vercel.app'}/api/kv/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        key: `user_${token}`, 
        value: JSON.stringify(user), 
        ttlSec: 86400 
      })
    });

    if (!kvResponse.ok) {
      throw new Error('사용자 정보 저장 실패');
    }

    return res.status(200).json({
      success: true,
      token: token,
      user: user
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: '로그인 처리 중 오류가 발생했습니다.' });
  }
}
