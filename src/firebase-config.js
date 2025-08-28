import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Firebase Admin SDK 초기화
let app;

try {
  // 환경변수에서 Firebase 설정 가져오기
  const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
  };

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });

  console.log('✅ Firebase Admin SDK 초기화 성공');
} catch (error) {
  console.error('❌ Firebase Admin SDK 초기화 실패:', error.message);
  console.log('⚠️ Firebase 설정 없이 서버가 시작됩니다.');
}

export const auth = app ? app.auth() : null;
export const db = app ? app.firestore() : null;

// 사용자 데이터 관리 함수들
export const userService = {
  // 사용자 생성 또는 업데이트
  async createOrUpdateUser(email, userData = {}) {
    if (!db) throw new Error('Firebase not initialized');
    
    const userRef = db.collection('users').doc(email);
    await userRef.set({
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...userData
    }, { merge: true });
    
    return { email, ...userData };
  },

  // 사용자 정보 조회
  async getUser(email) {
    if (!db) throw new Error('Firebase not initialized');
    
    const userRef = db.collection('users').doc(email);
    const doc = await userRef.get();
    
    if (!doc.exists) {
      return null;
    }
    
    return { email, ...doc.data() };
  },

  // 크레딧 업데이트
  async updateCredits(email, credits) {
    if (!db) throw new Error('Firebase not initialized');
    
    const userRef = db.collection('users').doc(email);
    await userRef.update({
      credits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return credits;
  },

  // 크레딧 사용 내역 추가
  async addCreditHistory(email, action, amount, details = {}) {
    if (!db) throw new Error('Firebase not initialized');
    
    const historyRef = db.collection('users').doc(email).collection('creditHistory');
    await historyRef.add({
      action, // 'purchase', 'use', 'refund'
      amount,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  },

  // 크레딧 사용 내역 조회
  async getCreditHistory(email, limit = 50) {
    if (!db) throw new Error('Firebase not initialized');
    
    const historyRef = db.collection('users').doc(email).collection('creditHistory');
    const snapshot = await historyRef
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
};
