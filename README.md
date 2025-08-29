# ImageCraft Studio

Chrome 확장 프로그램 기반 AI 이미지 생성 서비스

## 🏗️ 시스템 아키텍처

### Redis 키 패턴

#### **사용량 추적**
```
quota:YYYYMMDD:IP
예: quota:20241201:192.168.1.1 = "3"
설명: 일일 IP별 사용량 (24시간 TTL)
```

#### **사용자 크레딧**
```
credits:email
예: credits:user@example.com = "150"
설명: 사용자별 크레딧 (Firebase와 동기화)
```

#### **결제 상태**
```
paid:YYYYMMDD:IP
예: paid:20241201:192.168.1.1 = "1"
설명: 일일 결제 완료 상태 (24시간 TTL)
```

#### **일일 예산**
```
budget:YYYYMMDD
예: budget:20241201 = "5000"
설명: 일일 전체 예산 사용량 (24시간 TTL)
```

### 데이터 흐름

#### **로그인 사용자**
1. Firebase에서 크레딧 조회
2. 크레딧 > 0: 크레딧 차감 (Firebase)
3. 크레딧 = 0: IP 기반 무료 한도 (Redis)

#### **비로그인 사용자**
1. Redis에서 IP 기반 사용량 조회
2. 일일 한도 체크 (Redis)
3. 예산 체크 (Redis)

### 환경 변수

```bash
# Redis
REDIS_URL=rediss://default:password@host:port

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@project.iam.gserviceaccount.com

# Google Gemini
GEMINI_API_KEY=your-gemini-api-key

# PayPal
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_CLIENT_SECRET=your-paypal-client-secret
PAYPAL_ENV=live

# 예산 설정
DAILY_LIMIT=3
DAILY_BUDGET_KRW=160
COST_PER_CALL_KRW=1
```

## 🚀 배포

### Vercel 배포
```bash
vercel --prod
```

### 로컬 개발
```bash
cd server
npm install
npm run dev
```

## 🔧 문제 해결

### Redis 연결 문제
1. `REDIS_URL` 환경 변수 확인
2. Redis 서비스 상태 확인
3. 네트워크 연결 확인

### Firebase 연결 문제
1. 서비스 계정 키 확인
2. 프로젝트 ID 확인
3. 권한 설정 확인
