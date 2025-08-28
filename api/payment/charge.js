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

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: '인증 토큰이 필요합니다.' });
    }

    const token = authHeader.substring(7);
    const { amount = 10 } = req.body; // 기본 10크레딧 충전

    // 현재 사용자 정보 조회
    const userResponse = await fetch(`${process.env.VERCEL_URL || 'https://image-craft-studio-dk4o.vercel.app'}/api/kv/get?key=${encodeURIComponent(`user_${token}`)}`);
    
    if (!userResponse.ok) {
      return res.status(401).json({ success: false, error: '유효하지 않은 토큰입니다.' });
    }

    const userData = await userResponse.json();
    if (!userData.ok || !userData.value) {
      return res.status(401).json({ success: false, error: '유효하지 않은 토큰입니다.' });
    }

    const user = JSON.parse(userData.value);
    
    // 크레딧 충전
    user.credits += amount;
    user.lastCharged = new Date().toISOString();

    // 업데이트된 사용자 정보 저장
    const updateResponse = await fetch(`${process.env.VERCEL_URL || 'https://image-craft-studio-dk4o.vercel.app'}/api/kv/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        key: `user_${token}`, 
        value: JSON.stringify(user), 
        ttlSec: 86400 
      })
    });

    if (!updateResponse.ok) {
      throw new Error('사용자 정보 업데이트 실패');
    }

    // 결제 내역 저장
    const paymentHistory = {
      userId: user.email,
      amount: amount,
      type: 'charge',
      timestamp: new Date().toISOString()
    };

    await fetch(`${process.env.VERCEL_URL || 'https://image-craft-studio-dk4o.vercel.app'}/api/kv/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        key: `payment_${Date.now()}`, 
        value: JSON.stringify(paymentHistory), 
        ttlSec: 2592000 // 30일 보관
      })
    });

    return res.status(200).json({
      success: true,
      message: `${amount}크레딧이 충전되었습니다.`,
      user: user
    });

  } catch (error) {
    console.error('Charge error:', error);
    return res.status(500).json({ success: false, error: '크레딧 충전 중 오류가 발생했습니다.' });
  }
}
