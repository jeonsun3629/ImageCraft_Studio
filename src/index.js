import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fetch from 'node-fetch';
import genaiPkg from '@google/genai';
const { GoogleGenAI } = genaiPkg;
import Redis from 'ioredis';
import { userService, db } from './firebase-config.js';
import { generateToken, authenticateToken, optionalAuth } from './auth-middleware.js';

// Config
const PORT = process.env.PORT || 8787;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 3);
const PURCHASED_LIMIT = Number(process.env.PURCHASED_LIMIT || 20);
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const DAILY_BUDGET_KRW = Number(process.env.DAILY_BUDGET_KRW || 10000);
// Pricing: derive cost per image call in KRW from USD/unit and FX, unless overridden
const USD_PER_IMAGE = Number(process.env.USD_PER_IMAGE || '0.039');
const FX_KRW_PER_USD = Number(process.env.FX_KRW_PER_USD || '1380');
const DERIVED_COST_PER_CALL = Math.ceil(USD_PER_IMAGE * FX_KRW_PER_USD);
const COST_PER_CALL_KRW = Number(process.env.COST_PER_CALL_KRW || DERIVED_COST_PER_CALL);
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_ENV = process.env.PAYPAL_ENV || 'sandbox'; // 'sandbox' | 'live'
const PAYPAL_API_BASE = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

if (!GEMINI_API_KEY) {
  // Warning only to allow boot without key for quota checks
  console.warn('[warn] GEMINI_API_KEY is not set. /generate will fail until provided.');
}

let redis = null;
if (REDIS_URL) {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3
  });
  redis.on('error', (err) => console.error('[redis] error', err));
  redis.connect().catch((e) => console.error('[redis] connect failed', e));
} else {
  console.warn('[warn] REDIS_URL not set. Falling back to in-memory counter (single-instance only).');
}

// In-memory fallback store (for local dev only)
const memoryStore = new Map();

function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function getTodayKey(ip) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `quota:${y}${m}${day}:${ip}`;
}

function getCreditsKey(ip) {
  return `credits:${ip}`;
}

function getPaidKey(ip) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `paid:${y}${m}${day}:${ip}`;
}

function getBudgetKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `budget:${y}${m}${day}`;
}

async function incrAndGetRemaining(email, effectiveLimit) {
  const credits = await getCredits(email);
  if (credits > 0) {
    // 크레딧이 있으면 크레딧 차감 (10크레딧 차감)
    const success = await useCredits(email, 10);
    if (success) {
      const remainingCredits = await getCredits(email);
      return remainingCredits;
    } else {
      return 0; // 크레딧 부족
    }
  } else {
    // 크레딧이 없으면 일일 무료 한도 사용 (IP 기반)
    const ip = getClientKey(req);
    const key = getTodayKey(ip);
    if (redis) {
      const tx = redis.multi();
      tx.incr(key);
      tx.ttl(key);
      const [count, ttl] = await tx.exec().then((res) => res.map((x) => x[1]));
      if (ttl === -1) {
        await redis.expire(key, 86400);
      }
      return Math.max(effectiveLimit - Number(count), 0);
    }
    // memory fallback
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const resetAt = dayStart.getTime() + 86400 * 1000;
    const item = memoryStore.get(key) || { count: 0, resetAt };
    if (now > item.resetAt) {
      item.count = 0;
      item.resetAt = resetAt;
    }
    item.count += 1;
    memoryStore.set(key, item);
    return Math.max(effectiveLimit - item.count, 0);
  }
}

async function getRemaining(ip, effectiveLimit) {
  const credits = await getCredits(ip);
  if (credits > 0) {
    return credits; // 크레딧이 있으면 크레딧 반환
  } else {
    // 크레딧이 없으면 일일 무료 한도 확인
    const key = getTodayKey(ip);
    if (redis) {
      const count = Number((await redis.get(key)) || 0);
      return Math.max(effectiveLimit - count, 0);
    }
    const item = memoryStore.get(key);
    return Math.max(effectiveLimit - (item?.count || 0), 0);
  }
}

async function getCredits(email) {
  try {
    if (!email) return 0;
    
    const user = await userService.getUser(email);
    return user ? (user.credits || 0) : 0;
  } catch (error) {
    console.error('getCredits error:', error);
    return 0;
  }
}

async function addCredits(email, amount) {
  try {
    if (!email) throw new Error('Email required');
    
    const user = await userService.getUser(email);
    if (!user) {
      await userService.createOrUpdateUser(email, { credits: amount });
      return amount;
    }
    
    const newCredits = (user.credits || 0) + amount;
    await userService.updateCredits(email, newCredits);
    
    // 크레딧 충전 내역 추가
    await userService.addCreditHistory(email, 'purchase', amount, {
      source: 'paypal',
      amount: amount
    });
    
    return newCredits;
  } catch (error) {
    console.error('addCredits error:', error);
    throw error;
  }
}

async function useCredits(email, amount = 10) {
  try {
    if (!email) return false;
    
    const user = await userService.getUser(email);
    if (!user || (user.credits || 0) < amount) {
      return false;
    }
    
    const newCredits = user.credits - amount;
    await userService.updateCredits(email, newCredits);
    
    // 크레딧 사용 내역 추가
    await userService.addCreditHistory(email, 'use', -amount, {
      action: 'image_generation',
      cost: amount
    });
    
    return true;
  } catch (error) {
    console.error('useCredits error:', error);
    return false;
  }
}

async function hasPaid(ip) {
  const key = getPaidKey(ip);
  if (redis) {
    const v = await redis.get(key);
    return v === '1';
  }
  const item = memoryStore.get(key);
  return item?.paid === true;
}

async function markPaid(ip) {
  const key = getPaidKey(ip);
  if (redis) {
    const tx = redis.multi();
    tx.set(key, '1');
    tx.expire(key, 86400);
    await tx.exec();
    return true;
  }
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const resetAt = dayStart.getTime() + 86400 * 1000;
  const item = memoryStore.get(key) || { paid: false, resetAt };
  if (now > item.resetAt) {
    item.paid = false;
    item.resetAt = resetAt;
  }
  item.paid = true;
  memoryStore.set(key, item);
  return true;
}

async function getEffectiveLimit(email) {
  const credits = await getCredits(email);
  if (credits > 0) {
    return credits; // 크레딧이 있으면 크레딧만큼 사용 가능
  }
  return DAILY_LIMIT; // 크레딧이 없으면 일일 무료 한도
}

async function getBudgetRemaining() {
  const key = getBudgetKey();
  if (redis) {
    const spent = Number((await redis.get(key)) || 0);
    return Math.max(DAILY_BUDGET_KRW - spent, 0);
  }
  const item = memoryStore.get(key);
  const spent = Number(item?.spent || 0);
  return Math.max(DAILY_BUDGET_KRW - spent, 0);
}

async function addSpendAndGetRemaining(amount) {
  const key = getBudgetKey();
  if (redis) {
    const tx = redis.multi();
    tx.incrby(key, amount);
    tx.ttl(key);
    const [spent, ttl] = await tx.exec().then((res) => res.map((x) => x[1]));
    if (ttl === -1) {
      await redis.expire(key, 86400);
    }
    return Math.max(DAILY_BUDGET_KRW - Number(spent), 0);
  }
  // memory fallback
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const resetAt = dayStart.getTime() + 86400 * 1000;
  const item = memoryStore.get(key) || { spent: 0, resetAt };
  if (now > item.resetAt) {
    item.spent = 0;
    item.resetAt = resetAt;
  }
  item.spent += Number(amount) || 0;
  memoryStore.set(key, item);
  return Math.max(DAILY_BUDGET_KRW - item.spent, 0);
}

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '22mb' }));
app.use(morgan('tiny'));

// Optional admin guard for test tools
function isAdminAuthorized(req) {
  try {
    const adminKey = process.env.ADMIN_TEST_KEY;
    const provided = req.headers['x-admin-key'] || req.query.adminKey || req.body?.adminKey;
    if (adminKey) {
      return provided && provided === adminKey;
    }
    const ip = req.ip || req.connection?.remoteAddress || '';
    return ip.includes('127.0.0.1') || ip.includes('::1') || req.hostname === 'localhost';
  } catch (e) {
    return false;
  }
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    limit: DAILY_LIMIT,
    purchasedLimit: PURCHASED_LIMIT,
    dailyBudgetKrw: DAILY_BUDGET_KRW,
    costPerCallKrw: COST_PER_CALL_KRW,
    usdPerImage: USD_PER_IMAGE,
    fxKrwPerUsd: FX_KRW_PER_USD,
    paypalEnv: PAYPAL_ENV,
    paypalClientIdConfigured: Boolean(PAYPAL_CLIENT_ID)
  });
});

app.get('/quota', optionalAuth, async (req, res) => {
  try {
    const email = req.user?.email;
    const ip = getClientKey(req);
    
    let effectiveLimit, remaining, credits;
    
    if (email) {
      // 로그인된 사용자: 이메일 기반 크레딧
      effectiveLimit = await getEffectiveLimit(email);
      remaining = await getCredits(email);
      credits = remaining;
    } else {
      // 비로그인 사용자: IP 기반 무료 한도
      effectiveLimit = DAILY_LIMIT;
      const key = getTodayKey(ip);
      if (redis) {
        const count = Number((await redis.get(key)) || 0);
        remaining = Math.max(effectiveLimit - count, 0);
      } else {
        const item = memoryStore.get(key);
        remaining = Math.max(effectiveLimit - (item?.count || 0), 0);
      }
      credits = 0;
    }
    
    const budgetRemaining = await getBudgetRemaining();
    
    res.json({
      remaining,
      limit: effectiveLimit,
      remainingCredits: remaining,
      creditUnit: 10,
      baseLimit: DAILY_LIMIT,
      purchasedLimit: PURCHASED_LIMIT,
      budgetRemainingKrw: budgetRemaining,
      dailyBudgetKrw: DAILY_BUDGET_KRW,
      costPerCallKrw: COST_PER_CALL_KRW,
      usdPerImage: USD_PER_IMAGE,
      fxKrwPerUsd: FX_KRW_PER_USD,
      credits,
      isLoggedIn: !!email
    });
  } catch (e) {
    res.status(500).json({ error: 'quota_check_failed' });
  }
});

// Simple Firebase credit test page (no PayPal) - DEV ONLY
app.get('/test', (req, res) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).send('Forbidden');
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ImageCraft Studio - Firebase 연동 테스트</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans KR', sans-serif; padding: 24px; }
    .card { max-width: 720px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,.04); }
    h1 { font-size: 20px; margin: 0 0 16px; }
    label { display:block; font-size: 14px; color:#374151; margin: 10px 0 6px; }
    input { width: 100%; padding: 10px 12px; border:1px solid #d1d5db; border-radius: 8px; font-size:14px; }
    .row { display:flex; gap: 10px; }
    .row > div { flex: 1; }
    button { padding: 10px 14px; border: 0; border-radius: 8px; background: #4f46e5; color: white; cursor: pointer; }
    button.secondary { background: #6b7280; }
    button.danger { background: #ef4444; }
    .actions { display:flex; gap:10px; margin-top: 12px; flex-wrap: wrap; }
    pre { background:#111827; color:#e5e7eb; padding:12px; border-radius:8px; overflow:auto; max-height:270px; }
    .note { font-size:12px; color:#6b7280; margin-top:8px; }
  </style>
  </head>
  <body>
    <div class="card">
      <h1>Firebase 연동 테스트</h1>
      <div class="row">
        <div>
          <label>이메일</label>
          <input id="email" type="email" placeholder="user@example.com" />
        </div>
        <div>
          <label>추가 크레딧</label>
          <input id="amount" type="number" value="200" />
        </div>
      </div>
      <label>관리자 키 (선택, 서버에 설정된 경우 필수)</label>
      <input id="adminKey" type="password" placeholder="관리자 키" />
      <div class="actions">
        <button id="btnAdd">크레딧 추가</button>
        <button id="btnGet" class="secondary">크레딧 조회</button>
        <button id="btnReset" class="danger">크레딧 초기화(0)</button>
        <button id="btnDelete" class="danger">사용자 삭제</button>
      </div>
      <p class="note">이 페이지는 개발용 테스트 페이지입니다. 배포 시 비활성화하거나 관리자 키를 반드시 설정하세요.</p>
      <h3>결과</h3>
      <pre id="out">Ready.</pre>
    </div>
    <script>
      const base = location.origin;
      const out = document.getElementById('out');
      function show(o){ out.textContent = typeof o === 'string' ? o : JSON.stringify(o, null, 2); }
      async function req(path, method, body){
        const email = document.getElementById('email').value.trim();
        const adminKey = document.getElementById('adminKey').value.trim();
        const headers = { 'Content-Type':'application/json' };
        return fetch(base + path + (method==='GET' ? ('?email=' + encodeURIComponent(email) + '&adminKey=' + encodeURIComponent(adminKey)) : ''), {
          method,
          headers,
          body: method==='GET' ? undefined : JSON.stringify({ email, adminKey, ...body })
        }).then(r => r.json());
      }
      document.getElementById('btnAdd').onclick = async () => {
        const amount = Number(document.getElementById('amount').value || 0);
        const r = await req('/admin/credits/add', 'POST', { amount });
        show(r);
      };
      document.getElementById('btnGet').onclick = async () => {
        const r = await req('/admin/credits/get', 'GET');
        show(r);
      };
      document.getElementById('btnReset').onclick = async () => {
        const r = await req('/admin/credits/reset', 'POST');
        show(r);
      };
      document.getElementById('btnDelete').onclick = async () => {
        const r = await req('/admin/credits/delete-user', 'POST');
        show(r);
      };
    </script>
  </body>
  </html>`);
});

app.get('/budget', async (req, res) => {
  try {
    const remaining = await getBudgetRemaining();
    res.json({
      remainingKrw: remaining,
      dailyBudgetKrw: DAILY_BUDGET_KRW,
      costPerCallKrw: COST_PER_CALL_KRW,
      usdPerImage: USD_PER_IMAGE,
      fxKrwPerUsd: FX_KRW_PER_USD
    });
  } catch (e) {
    res.status(500).json({ error: 'budget_check_failed' });
  }
});

// Admin credit endpoints (development/test)
app.post('/admin/credits/add', async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) return res.status(403).json({ error: 'FORBIDDEN' });
    const { email, amount } = req.body || {};
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'INVALID_EMAIL' });
    const addAmount = Number(amount || 0);
    if (!Number.isFinite(addAmount) || addAmount === 0) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    const newCredits = await addCredits(email, addAmount);
    res.json({ ok: true, email, credits: newCredits });
  } catch (e) {
    console.error('admin add error', e);
    res.status(500).json({ error: 'ADMIN_ADD_FAILED' });
  }
});

app.get('/admin/credits/get', async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) return res.status(403).json({ error: 'FORBIDDEN' });
    const email = String(req.query.email || '').trim();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'INVALID_EMAIL' });
    const user = await userService.getUser(email);
    res.json({ ok: true, email, credits: user?.credits || 0, exists: !!user });
  } catch (e) {
    console.error('admin get error', e);
    res.status(500).json({ error: 'ADMIN_GET_FAILED' });
  }
});

app.post('/admin/credits/reset', async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) return res.status(403).json({ error: 'FORBIDDEN' });
    const { email } = req.body || {};
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'INVALID_EMAIL' });
    await userService.updateCredits(email, 0);
    await userService.addCreditHistory(email, 'admin_reset', 0, { reason: 'manual_reset' });
    res.json({ ok: true, email, credits: 0 });
  } catch (e) {
    console.error('admin reset error', e);
    res.status(500).json({ error: 'ADMIN_RESET_FAILED' });
  }
});

app.post('/admin/credits/delete-user', async (req, res) => {
  try {
    if (!isAdminAuthorized(req)) return res.status(403).json({ error: 'FORBIDDEN' });
    const { email } = req.body || {};
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'INVALID_EMAIL' });
    if (!db) return res.status(500).json({ error: 'FIREBASE_NOT_INITIALIZED' });
    await db.collection('users').doc(email).delete();
    res.json({ ok: true, email, deleted: true });
  } catch (e) {
    console.error('admin delete user error', e);
    res.status(500).json({ error: 'ADMIN_DELETE_FAILED' });
  }
});

// 사용자 등록/로그인
app.post('/auth/login', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'INVALID_EMAIL' });
    }

    // 사용자 생성 또는 조회
    let user = await userService.getUser(email);
    if (!user) {
      user = await userService.createOrUpdateUser(email, { credits: 0 });
    }

    // JWT 토큰 생성
    const token = generateToken(email);

    res.json({
      success: true,
      user: {
        email: user.email,
        credits: user.credits || 0,
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'LOGIN_FAILED' });
  }
});

// 사용자 정보 조회
app.get('/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const user = await userService.getUser(email);
    
    if (!user) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    res.json({
      success: true,
      user: {
        email: user.email,
        credits: user.credits || 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'PROFILE_FETCH_FAILED' });
  }
});

// 크레딧 사용 내역 조회
app.get('/auth/credit-history', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { limit = 50 } = req.query;
    
    const raw = await userService.getCreditHistory(email, parseInt(limit));
    // Normalize timestamp for JSON clients (string ISO)
    const history = raw.map((item) => {
      let iso = null;
      const ts = item.timestamp;
      if (typeof ts === 'string') {
        iso = ts;
      } else if (ts && typeof ts.toDate === 'function') {
        iso = ts.toDate().toISOString();
      } else if (ts && typeof ts._seconds === 'number') {
        iso = new Date(ts._seconds * 1000).toISOString();
      } else if (ts && typeof ts.seconds === 'number') {
        iso = new Date(ts.seconds * 1000).toISOString();
      }
      return { ...item, timestamp: iso };
    });
    
    return res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Credit history error:', error);
    res.status(500).json({ error: 'HISTORY_FETCH_FAILED' });
  }
});

async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error('paypal_not_configured');
  const resp = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    // node-fetch supports basic auth via Authorization header
    // We manually set it:
    // 'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')
  });
}

// Purchase confirmation endpoint: verify PayPal and mark today's IP as paid
app.post('/purchase/confirm', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { orderId, amount } = req.body || {};
    
    if (!orderId) {
      return res.status(400).json({ error: 'BAD_REQUEST' });
    }

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      return res.status(500).json({ error: 'PAYPAL_NOT_CONFIGURED' });
    }

    // Get access token
    const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const tokenResp = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basic}`
      },
      body: 'grant_type=client_credentials'
    });
    if (!tokenResp.ok) {
      return res.status(502).json({ error: 'PAYPAL_TOKEN_FAILED' });
    }
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;

    // Verify order details
    const orderResp = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!orderResp.ok) {
      return res.status(502).json({ error: 'PAYPAL_ORDER_FETCH_FAILED' });
    }
    const order = await orderResp.json();
    const status = order.status;
    const unit = order.purchase_units && order.purchase_units[0];
    const amountValue = unit?.amount?.value;
    const currency = unit?.amount?.currency_code;
    if (status !== 'COMPLETED' && status !== 'APPROVED') {
      return res.status(400).json({ error: 'ORDER_NOT_APPROVED' });
    }
    if (currency !== 'USD' || Number(amountValue) < 0.99) {
      return res.status(400).json({ error: 'INVALID_ORDER_AMOUNT' });
    }

    // 결제 완료 시 200 크레딧 추가
    await addCredits(email, 200);
    const effectiveLimit = await getEffectiveLimit(email);
    const remaining = await getCredits(email);
    res.json({ ok: true, limit: effectiveLimit, remaining, remainingCredits: remaining });
  } catch (e) {
    console.error('Purchase confirm error:', e);
    res.status(500).json({ error: 'purchase_confirm_failed' });
  }
});

// Professional checkout page using PayPal JS SDK
app.get('/pay', (req, res) => {
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>크레딧 충전 - ImageCraft Studio</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      
      .checkout-container {
        background: white;
        border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        overflow: hidden;
        max-width: 480px;
        width: 100%;
      }
      
      .checkout-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px;
        text-align: center;
      }
      
      .checkout-header h1 {
        font-size: 24px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      
      .checkout-header p {
        opacity: 0.9;
        font-size: 14px;
      }
      
      .checkout-content {
        padding: 40px 30px;
      }
      
      .product-info {
        background: #f8f9fa;
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 30px;
        border: 1px solid #e9ecef;
      }
      
      .product-title {
        font-size: 18px;
        font-weight: 600;
        color: #333;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .product-title::before {
        content: "🎨";
        font-size: 24px;
      }
      
      .product-details {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      
      .product-details span {
        color: #666;
        font-size: 14px;
      }
      
      .price {
        font-size: 28px;
        font-weight: 700;
        color: #667eea;
      }
      
      .features {
        list-style: none;
        margin-top: 16px;
      }
      
      .features li {
        color: #666;
        font-size: 14px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .features li::before {
        content: "✓";
        color: #28a745;
        font-weight: bold;
      }
      
      .payment-section {
        margin-bottom: 30px;
      }
      
      .payment-section h3 {
        font-size: 16px;
        font-weight: 600;
        color: #333;
        margin-bottom: 16px;
      }
      
      .payment-methods {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .payment-method {
        border: 2px solid #e9ecef;
        border-radius: 8px;
        padding: 16px;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .payment-method:hover {
        border-color: #667eea;
        background: #f8f9ff;
      }
      
      .payment-method.selected {
        border-color: #667eea;
        background: #f8f9ff;
      }
      
      .payment-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        font-size: 18px;
      }
      
      .payment-text {
        flex: 1;
      }
      
      .payment-text h4 {
        font-size: 14px;
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }
      
      .payment-text p {
        font-size: 12px;
        color: #666;
      }
      
      .paypal-icon {
        background: #ffc439;
        color: #003087;
      }
      
      .card-icon {
        background: #333;
        color: white;
      }
      
      .security-info {
        background: #e8f5e8;
        border: 1px solid #c3e6cb;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 24px;
      }
      
      .security-info h4 {
        color: #155724;
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .security-info h4::before {
        content: "🔒";
      }
      
      .security-info p {
        color: #155724;
        font-size: 12px;
        line-height: 1.4;
      }
      
      #paypal-button-container {
        margin-bottom: 16px;
      }
      
      #status {
        text-align: center;
        padding: 12px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        margin-top: 16px;
      }
      
      .status-success {
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }
      
      .status-error {
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }
      
      .status-warning {
        background: #fff3cd;
        color: #856404;
        border: 1px solid #ffeaa7;
      }
      
      .footer {
        text-align: center;
        padding: 20px 30px;
        background: #f8f9fa;
        border-top: 1px solid #e9ecef;
        color: #666;
        font-size: 12px;
      }
    </style>
    <script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(process.env.PAYPAL_CLIENT_ID || 'sb')}&currency=USD" data-sdk-integration-source="button-factory"></script>
  </head>
  <body>
    <div class="checkout-container">
      <div class="checkout-header">
        <h1>크레딧 충전</h1>
        <p>ImageCraft Studio</p>
      </div>
      
      <div class="checkout-content">
        <div class="product-info">
          <div class="product-title">200 크레딧 패키지</div>
          <div class="product-details">
            <span>이미지 생성 크레딧</span>
            <div class="price">$0.99</div>
          </div>
          <ul class="features">
            <li>200 크레딧으로 20장의 이미지 생성 가능 (1장당 10크레딧)</li>
            <li>당일 한도 즉시 업그레이드</li>
            <li>안전한 PayPal 결제</li>
            <li>즉시 사용 가능</li>
          </ul>
          
        </div>
        
        <div class="security-info">
          <h4>안전한 결제</h4>
          <p>모든 결제는 PayPal의 보안 시스템을 통해 처리되며, 개인정보는 안전하게 보호됩니다.</p>
        </div>
        
        <div class="payment-section">
          <h3>결제 방법 선택</h3>
        </div>
        
        <div id="paypal-button-container"></div>
        <div id="status"></div>
      </div>
      
      <div class="footer">
        <p>© 2024 ImageCraft Studio. 모든 결제는 PayPal을 통해 처리됩니다.</p>
      </div>
    </div>
    
    <script>
      function setStatus(message, type) {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = 'status-' + type;
      }
      
      paypal.Buttons({
        createOrder: function(data, actions) {
          return actions.order.create({
            purchase_units: [{
              amount: { value: '0.99', currency_code: 'USD' },
              description: '200 credits for ImageCraft Studio'
            }]
          });
        },
        onApprove: async function(data, actions) {
          try {
            setStatus('결제 처리 중...', 'warning');
            await actions.order.capture();
            const resp = await fetch('/purchase/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: data.orderID, amount: '0.99' })
            });
            if(!resp.ok){ throw new Error('confirm_failed') }
            setStatus('결제가 완료되었습니다! 200 크레딧이 추가되었습니다.', 'success');
          } catch(e){
            console.error(e);
            setStatus('결제 처리 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
          }
        },
        onCancel: function(){ 
          setStatus('결제가 취소되었습니다.', 'warning'); 
        },
        onError: function(err){ 
          console.error(err); 
          setStatus('결제 중 오류가 발생했습니다. 다시 시도해주세요.', 'error'); 
        }
      }).render('#paypal-button-container');
    </script>
  </body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.post('/generate', optionalAuth, async (req, res) => {
  try {
    const email = req.user?.email;
    const ip = getClientKey(req);
    
    let effectiveLimit, remainingBefore;
    let userCredits = 0;
    if (email) {
      userCredits = await getCredits(email);
    }
    
    if (email && userCredits > 0) {
      // 로그인 + 크레딧 보유: 크레딧 우선, 일일 한도/예산 무시
      effectiveLimit = userCredits;
      remainingBefore = userCredits;
    } else {
      // 비로그인 또는 크레딧 없음: IP 기반 무료 한도와 예산 적용
      effectiveLimit = DAILY_LIMIT;
      const key = getTodayKey(ip);
      if (redis) {
        const count = Number((await redis.get(key)) || 0);
        remainingBefore = Math.max(effectiveLimit - count, 0);
      } else {
        const item = memoryStore.get(key);
        remainingBefore = Math.max(effectiveLimit - (item?.count || 0), 0);
      }
    }
    
    if (remainingBefore <= 0) {
      return res.status(402).json({ error: 'FREE_LIMIT_EXCEEDED' });
    }

    // 예산 체크: 비로그인 또는 크레딧 없는 경우에만
    if (!(email && userCredits > 0)) {
      const budgetRemainingBefore = await getBudgetRemaining();
      if (budgetRemainingBefore < COST_PER_CALL_KRW) {
        return res.status(402).json({ error: 'BUDGET_EXCEEDED' });
      }
    }

    const { base64Image1, base64Image2, prompt, mimeType1, mimeType2 } = req.body || {};
    if (!base64Image1 || !prompt) {
      return res.status(400).json({ error: 'BAD_REQUEST' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'SERVER_MISCONFIGURED' });
    }

    // 차감은 성공 후에만 진행 (크레딧 보유자)
    let remainingAfter, budgetRemainingAfter;

    // Use official SDK for reliability
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    // Order parts to emphasize image-editing: image first, then instruction
    const instruction = `${String(prompt).slice(0, 1000)}\n\nReturn the edited image as output.`;
    
    // Prepare parts array with images
    const requestParts = [
      { inlineData: { mimeType: mimeType1 || 'image/png', data: base64Image1 } }
    ];
    
    // Add second image if provided
    if (base64Image2) {
      requestParts.push({ inlineData: { mimeType: mimeType2 || 'image/png', data: base64Image2 } });
    }
    
    // Add text instruction
    requestParts.push({ text: instruction });
    
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: [
        {
          role: 'user',
          parts: requestParts
        }
      ],
      responseModalities: ['IMAGE']
    });

    let outBase64 = null;
    let outMime = mimeType1 || 'image/png';
    const responseParts = result?.candidates?.[0]?.content?.parts || result?.response?.candidates?.[0]?.content?.parts || [];
    for (const p of responseParts) {
      if (p.inlineData?.data) {
        outBase64 = p.inlineData.data;
        outMime = p.inlineData.mimeType || outMime;
        break;
      }
      if (p.inline_data?.data) {
        outBase64 = p.inline_data.data;
        outMime = p.inline_data.mime_type || outMime;
        break;
      }
    }

    if (!outBase64) {
      console.error('sdk unexpected response', JSON.stringify(result?.response || {}).slice(0, 2000));
      return res.status(500).json({ error: 'NO_IMAGE_RETURNED' });
    }

    // 여기까지 오면 성공: 이제 차감 수행
    if (email && userCredits > 0) {
      const ok = await useCredits(email, 10);
      if (!ok) {
        // 드문 레이스 컨디션: 크레딧이 사라진 경우 실패 처리
        return res.status(402).json({ error: 'FREE_LIMIT_EXCEEDED' });
      }
      remainingAfter = await getCredits(email);
      budgetRemainingAfter = await getBudgetRemaining();
    } else {
      // 무료 사용자 카운트 및 예산 차감
      const key = getTodayKey(ip);
      if (redis) {
        const tx = redis.multi();
        tx.incr(key);
        tx.ttl(key);
        const [count, ttl] = await tx.exec().then((res) => res.map((x) => x[1]));
        if (ttl === -1) {
          await redis.expire(key, 86400);
        }
        remainingAfter = Math.max(DAILY_LIMIT - Number(count), 0);
      } else {
        const now = Date.now();
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const resetAt = dayStart.getTime() + 86400 * 1000;
        const key2 = getTodayKey(ip);
        const item = memoryStore.get(key2) || { count: 0, resetAt };
        if (now > item.resetAt) { item.count = 0; item.resetAt = resetAt; }
        item.count += 1;
        memoryStore.set(key2, item);
        remainingAfter = Math.max(DAILY_LIMIT - item.count, 0);
      }
      budgetRemainingAfter = await addSpendAndGetRemaining(COST_PER_CALL_KRW);
    }

    return res.json({ imageData: outBase64, mimeType: outMime, remaining: remainingAfter, remainingCredits: remainingAfter, creditUnit: 10, budgetRemainingKrw: budgetRemainingAfter });
  } catch (e) {
    console.error('generate error', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

app.listen(PORT, () => {
  console.log(`proxy listening on :${PORT}`);
});



