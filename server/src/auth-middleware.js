import jwt from 'jsonwebtoken';
import { auth } from './firebase-config.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// JWT 토큰 생성
export function generateToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
}

// JWT 토큰 검증
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Firebase ID 토큰 검증
export async function verifyFirebaseToken(idToken) {
  try {
    if (!auth) throw new Error('Firebase Auth not initialized');
    
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Firebase token verification failed:', error.message);
    return null;
  }
}

// 인증 미들웨어
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'ACCESS_TOKEN_REQUIRED' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'INVALID_TOKEN' });
  }

  req.user = decoded;
  next();
}

// 선택적 인증 미들웨어 (토큰이 있으면 검증, 없으면 통과)
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  next();
}
