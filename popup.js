// DOM 요소들
const selectAreaBtn = document.getElementById('select-area-btn');
const clearImagesBtn = document.getElementById('clear-images-btn');
const clearImage1Btn = document.getElementById('clear-image1-btn');
const clearImage2Btn = document.getElementById('clear-image2-btn');
const promptInput = document.getElementById('prompt-input');
const generateBtn = document.getElementById('generate-btn');
const screenshot1 = document.getElementById('screenshot1');
const screenshot2 = document.getElementById('screenshot2');
const screenshotPlaceholder1 = document.getElementById('screenshot-placeholder1');
const screenshotPlaceholder2 = document.getElementById('screenshot-placeholder2');
const loading = document.getElementById('loading');
const resultSection = document.getElementById('result-section');
const generatedImage = document.getElementById('generated-image');
const downloadBtn = document.getElementById('download-btn');
const newGenerationBtn = document.getElementById('new-generation-btn');
const errorMessage = document.getElementById('error-message');

// 상태 변수들
let currentScreenshots = [null, null]; // 2개의 이미지를 저장하는 배열
let generatedImageData = null; // 생성된 이미지 데이터
let apiKey = 'proxy';
let currentIp = null; // 더 이상 사용하지 않지만 남겨둠 (호환성)
let currentIpUsageCount = 0; // 더 이상 사용하지 않지만 남겨둠 (호환성)
let remainingCredits = null; // 서버가 제공하는 남은 크레딧 수

// Vercel API 주소
const VERCEL_API_BASE = 'https://image-craft-studio-dk4o.vercel.app/api/kv';
const PROXY_BASE_URL = 'http://localhost:8787';
const SERVER_URL = PROXY_BASE_URL; // SERVER_URL을 PROXY_BASE_URL과 동일하게 설정

// 인증 관련 변수
let authToken = null;
let currentUser = null;

// KV 저장소 함수들
async function kvSet(key, value, ttlSec = 3600) {
  try {
    const response = await fetch(`${VERCEL_API_BASE}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, ttlSec })
    });
    
    if (!response.ok) {
      throw new Error(`KV SET failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.ok ? data.result : null;
  } catch (error) {
    console.error('KV SET error:', error);
    return null;
  }
}

async function kvGet(key) {
  try {
    const response = await fetch(`${VERCEL_API_BASE}/get?key=${encodeURIComponent(key)}`);
    
    if (!response.ok) {
      throw new Error(`KV GET failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.ok ? data.value : null;
  } catch (error) {
    console.error('KV GET error:', error);
    return null;
  }
}

// 페이지 로드 시 저장된 토큰 확인
document.addEventListener('DOMContentLoaded', async function() {
  const savedToken = localStorage.getItem('authToken');
  if (savedToken) {
    authToken = savedToken;
    await loadUserProfile();
  }
  
  // 기존 초기화 코드
  await updateQuota();
  setupEventListeners();
});

// 로그인 함수
async function login(email) {
  try {
    const response = await fetch(`${SERVER_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email })
    });

    const data = await response.json();
    
    if (data.success) {
      authToken = data.token;
      currentUser = data.user;
      
      // 토큰 저장
      localStorage.setItem('authToken', authToken);
      
      // UI 업데이트
      updateAuthUI();
      await updateQuota();
      // 로그인 직후 즉시 버튼 복구
      await checkServerQuota();
      generateBtn.removeAttribute('data-over-limit');
      updateGenerateButton();
      
      return true;
    } else {
      throw new Error(data.error || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    showError('로그인에 실패했습니다: ' + error.message);
    return false;
  }
}

// 로그아웃 함수
function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  updateAuthUI();
  remainingCredits = null;
  updateQuota();
  updateGenerateButton();
}

// 사용자 프로필 로드
async function loadUserProfile() {
  try {
    const response = await fetch(`${SERVER_URL}/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    
    if (data.success) {
      currentUser = data.user;
      updateAuthUI();
      await checkServerQuota();
      generateBtn.removeAttribute('data-over-limit');
      updateGenerateButton();
    } else {
      // 토큰이 유효하지 않으면 로그아웃
      logout();
    }
  } catch (error) {
    console.error('Profile load error:', error);
    logout();
  }
}

// 인증 UI 업데이트
function updateAuthUI() {
  const authSection = document.getElementById('auth-section');
  const userInfo = document.getElementById('user-info');
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('logout-btn');
  
  if (currentUser) {
    // 로그인된 상태
    authSection.style.display = 'block';
    userInfo.style.display = 'block';
    loginForm.style.display = 'none';
    
    document.getElementById('user-email').textContent = currentUser.email;
    document.getElementById('user-credits').textContent = currentUser.credits || 0;
  } else {
    // 로그아웃된 상태
    authSection.style.display = 'block';
    userInfo.style.display = 'none';
    loginForm.style.display = 'block';
  }
}

// 크레딧 사용 내역 조회
async function loadCreditHistory() {
  if (!authToken) return;
  
  try {
    const response = await fetch(`${SERVER_URL}/auth/credit-history`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    
    if (data.success) {
      displayCreditHistory(data.history);
    }
  } catch (error) {
    console.error('Credit history error:', error);
  }
}

// 크레딧 사용 내역 표시
function displayCreditHistory(history) {
  const historyContainer = document.getElementById('credit-history');
  if (!historyContainer) return;
  
  historyContainer.innerHTML = '';
  
  history.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'history-item';
    
    const action = item.action === 'purchase' ? '충전' : 
                   item.action === 'use' ? '사용' : '기타';
    const amount = item.amount > 0 ? `+${item.amount}` : item.amount;
    let when = item.timestamp;
    // Support ISO string or Firestore Timestamp-like objects
    if (when && typeof when.toDate === 'function') {
      when = when.toDate();
    } else if (when && typeof when === 'object' && typeof when.seconds === 'number') {
      when = new Date(when.seconds * 1000);
    } else if (when && typeof when === 'object' && typeof when._seconds === 'number') {
      when = new Date(when._seconds * 1000);
    } else if (typeof when === 'string') {
      when = new Date(when);
    }
    const date = when ? new Date(when).toLocaleString() : '';
    
    itemDiv.innerHTML = `
      <span class="action">${action}</span>
      <span class="amount">${amount}</span>
      <span class="date">${date}</span>
    `;
    
    historyContainer.appendChild(itemDiv);
  });
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 인증 관련 이벤트 리스너
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const historyBtn = document.getElementById('history-btn');
  const closeHistoryBtn = document.getElementById('close-history-btn');
  const emailInput = document.getElementById('email-input');
  
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email || !email.includes('@')) {
        showError('유효한 이메일 주소를 입력해주세요.');
        return;
      }
      
      loginBtn.disabled = true;
      loginBtn.textContent = '로그인 중...';
      
      const success = await login(email);
      
      loginBtn.disabled = false;
      loginBtn.textContent = '로그인';
      
      if (success) {
        showSuccess('로그인되었습니다!');
      }
    });
  }
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      logout();
      showSuccess('로그아웃되었습니다.');
    });
  }
  
  if (historyBtn) {
    historyBtn.addEventListener('click', async () => {
      await loadCreditHistory();
      document.getElementById('credit-history').style.display = 'block';
      document.getElementById('user-info').style.display = 'none';
    });
  }
  
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
      document.getElementById('credit-history').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
    });
  }
  
  if (emailInput) {
    emailInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        loginBtn.click();
      }
    });
  }
}

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
  console.log('팝업 초기화 시작');
  
  // 저장된 토큰 확인
  const savedToken = localStorage.getItem('authToken');
  if (savedToken) {
    authToken = savedToken;
    await loadUserProfile();
  }
  
  await checkServerQuota();
  
  // 먼저 저장된 이미지 복원
  await restoreSavedImages();
  
  // 생성된 이미지 복원
  await restoreGeneratedImage();
  
  // 그 다음 새로운 캡처 확인
  await checkForCapturedScreenshot();
  
  console.log('초기화 완료, 현재 상태:', { 
    hasFirstImage: currentScreenshots[0] !== null, 
    hasSecondImage: currentScreenshots[1] !== null,
    hasGeneratedImage: generatedImageData !== null,
    isLoggedIn: !!authToken
  });
  
  updateGenerateButton();
});

// API 키 관련 UI/로직 제거 (프록시 사용)

// 이미지 감지 캡처
selectAreaBtn.addEventListener('click', async () => {
  try {
    // 현재 활성 탭에서 이미지 감지 시작
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      showError('활성 탭을 찾을 수 없습니다.');
      return;
    }

    // 이미지 감지 시작
    const response = await chrome.runtime.sendMessage({
      action: 'startImageDetection',
      tabId: tab.id
    });
    
    if (response.success) {
      // 팝업 닫기 (이미지 감지를 위해)
      window.close();
    } else {
      showError(`이미지 감지를 시작할 수 없습니다: ${response.error || '알 수 없는 오류'}`);
    }
  } catch (error) {
    console.error('이미지 감지 시작 실패:', error);
    showError('이미지 감지를 시작할 수 없습니다.');
  }
});

// 이미지 모두 지우기
clearImagesBtn.addEventListener('click', async () => {
  currentScreenshots = [null, null];
  screenshot1.style.display = 'none';
  screenshot2.style.display = 'none';
  screenshotPlaceholder1.style.display = 'flex';
  screenshotPlaceholder2.style.display = 'flex';
  clearImage1Btn.style.display = 'none';
  clearImage2Btn.style.display = 'none';
  
  await saveImages(); // 저장 업데이트
  
  updateGenerateButton();
  showSuccess('캡쳐 이미지들이 모두 지워졌습니다.');
});

// 첫 번째 이미지 지우기
clearImage1Btn.addEventListener('click', async () => {
  currentScreenshots[0] = null;
  screenshot1.style.display = 'none';
  screenshotPlaceholder1.style.display = 'flex';
  clearImage1Btn.style.display = 'none';
  await saveImages(); // 저장 업데이트
  updateGenerateButton();
  showSuccess('첫 번째 이미지가 지워졌습니다.');
});

// 두 번째 이미지 지우기
clearImage2Btn.addEventListener('click', async () => {
  currentScreenshots[1] = null;
  screenshot2.style.display = 'none';
  screenshotPlaceholder2.style.display = 'flex';
  clearImage2Btn.style.display = 'none';
  await saveImages(); // 저장 업데이트
  updateGenerateButton();
  showSuccess('두 번째 이미지가 지워졌습니다.');
});

// 프롬프트 입력 감지
promptInput.addEventListener('input', () => {
  updateGenerateButton();
});

// 생성 버튼 상태 업데이트
function updateGenerateButton() {
  const hasAnyScreenshot = currentScreenshots[0] !== null || currentScreenshots[1] !== null;
  const hasPrompt = promptInput.value.trim().length > 0;
  // 프록시 사용 시 API 키는 항상 있다고 가정
  const hasApiKey = true;
  let isOverFreeLimit = generateBtn.getAttribute('data-over-limit') === '1';
  // 크레딧이 있으면 over-limit 상태를 해제
  if (typeof remainingCredits === 'number' && remainingCredits > 0) {
    isOverFreeLimit = false;
    generateBtn.removeAttribute('data-over-limit');
    // 결제용 onclick 제거
    generateBtn.onclick = null;
  }
  
  if (isOverFreeLimit) {
    generateBtn.textContent = '추가 생성을 위해 200 크레딧 충전';
  } else {
    if (typeof remainingCredits === 'number') {
      generateBtn.textContent = `이미지 생성 (${remainingCredits} 크레딧)`;
    } else {
      generateBtn.textContent = '이미지 생성';
    }
  }

  // 무료 한도 초과 상태에서는 결제 버튼으로 동작해야 하므로 항상 활성화
  // 그 외에는 기존 조건에 따라 활성/비활성 제어
  generateBtn.disabled = isOverFreeLimit ? false : !(hasAnyScreenshot && hasPrompt && hasApiKey);
}

// 이미지 생성
generateBtn.addEventListener('click', async () => {
  const hasAnyScreenshot = currentScreenshots[0] !== null || currentScreenshots[1] !== null;
  if (!hasAnyScreenshot || !promptInput.value.trim() || !apiKey) {
    showError('최소 하나의 이미지와 프롬프트가 필요합니다.');
    return;
  }

  try {
    // UI 상태 변경
    generateBtn.disabled = true;
    loading.style.display = 'block';
    resultSection.style.display = 'none';
    hideError();

    // 요청 제한을 피하기 위한 대기 시간
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 이미지 처리 - 첫 번째 또는 두 번째 이미지 중 존재하는 것 사용
    let base64Image1 = null;
    let inputMime1 = 'image/png';
    let base64Image2 = null;
    let inputMime2 = 'image/png';
    
    if (currentScreenshots[0]) {
      // 첫 번째 이미지가 있는 경우
      const mimeMatch1 = currentScreenshots[0].match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
      inputMime1 = mimeMatch1 ? mimeMatch1[1] : 'image/png';
      base64Image1 = currentScreenshots[0].split(',')[1];
      
      // 두 번째 이미지도 있는 경우
      if (currentScreenshots[1]) {
        const mimeMatch2 = currentScreenshots[1].match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
        inputMime2 = mimeMatch2 ? mimeMatch2[1] : 'image/png';
        base64Image2 = currentScreenshots[1].split(',')[1];
      }
    } else if (currentScreenshots[1]) {
      // 첫 번째 이미지는 없고 두 번째 이미지만 있는 경우
      const mimeMatch2 = currentScreenshots[1].match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
      inputMime1 = mimeMatch2 ? mimeMatch2[1] : 'image/png';
      base64Image1 = currentScreenshots[1].split(',')[1];
    } 
    
    // 이미지 크기 검증 (공식 문서 제한사항)
    const imageSize1 = Math.ceil(base64Image1.length * 0.75);
    const imageSize2 = base64Image2 ? Math.ceil(base64Image2.length * 0.75) : 0;
    const totalImageSize = imageSize1 + imageSize2;
    
    if (totalImageSize > 20 * 1024 * 1024) { // 20MB 제한
      showError('이미지 크기가 너무 큽니다. 더 작은 이미지를 선택해주세요.');
      return;
    }
    
    // 프롬프트 최적화 (공식 문서 가이드라인 적용)
    let optimizedPrompt = promptInput.value.trim();
    
    // 프롬프트가 너무 짧은 경우 기본 지시사항 추가
    if (optimizedPrompt.length < 10) {
      optimizedPrompt = `Modify this image: ${optimizedPrompt}`;
    }
    
    // 프롬프트 길이 제한 (공식 문서 권장사항)
    if (optimizedPrompt.length > 1000) {
      optimizedPrompt = optimizedPrompt.substring(0, 1000);
      console.warn('프롬프트가 너무 길어서 잘렸습니다.');
    }
    
    // 프록시 서버를 통해 Gemini API 호출 (2개 이미지 지원)
    const response = await callGeminiAPI(base64Image1, optimizedPrompt, inputMime1, base64Image2, inputMime2);
    
    if (response && response.imageData) {
      // 생성된 이미지 표시
      const outMime = response.mimeType || 'image/png';
      generatedImageData = `data:${outMime};base64,${response.imageData}`;
      generatedImage.src = generatedImageData;
      resultSection.style.display = 'block';
      // 크레딧 업데이트 (로그인 사용자)
      if (typeof response.remainingCredits === 'number') {
        remainingCredits = response.remainingCredits;
        const creditsEl = document.getElementById('user-credits');
        if (creditsEl) creditsEl.textContent = String(remainingCredits);
      }
      
      // 생성된 이미지 저장
      await saveGeneratedImage();
      
      showSuccess('이미지가 성공적으로 생성되었습니다!');

      // 성공 후 서버 쿼터 다시 확인 (일일 3회 제한 반영)
      await checkServerQuota();
      updateGenerateButton();
    } else {
      throw new Error('이미지 생성에 실패했습니다.');
    }
  } catch (error) {
    console.error('이미지 생성 실패:', error);
    
    // 서버 응답 기반 에러 메시지 처리
    const errorMessage = error.message || '';
    if (errorMessage.includes('FREE_LIMIT_EXCEEDED')) {
      showError('무료 사용 한도를 초과했습니다. 내일 다시 시도해주세요.');
      applyOverLimitUI();
    } else if (errorMessage.includes('BUDGET_EXCEEDED')) {
      showError('전체 일일 예산 한도를 초과했습니다. 내일 다시 시도해주세요.');
    } else if (errorMessage.includes('quota') || errorMessage.includes('rate-limits')) {
      showError('API 할당량이 초과되었습니다.');
    } else if (errorMessage.includes('TOO_MANY_REQUESTS')) {
      showError('요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    } else if (errorMessage.includes('BAD_REQUEST')) {
      showError('요청 형식이 올바르지 않습니다.');
    } else if (errorMessage.includes('PERMISSION_DENIED')) {
      showError('API 키가 유효하지 않거나 권한이 없습니다.');
    } else if (errorMessage.includes('INVALID_ARGUMENT')) {
      showError('입력 이미지 또는 프롬프트가 유효하지 않습니다.');
    } else if (errorMessage.includes('RESOURCE_EXHAUSTED')) {
      showError('API 할당량이 소진되었습니다.');
    } else {
      showError(`이미지 생성 실패: ${errorMessage}`);
    }
  } finally {
    loading.style.display = 'none';
    generateBtn.disabled = false;
  }
});

// 프록시를 통한 Gemini API 호출 (2개 이미지 지원)
async function callGeminiAPI(base64Image1, prompt, mimeType1 = 'image/png', base64Image2 = null, mimeType2 = 'image/png') {
  const url = `${PROXY_BASE_URL}/generate`;
  const payload = { 
    base64Image1, 
    prompt, 
    mimeType1,
    base64Image2,
    mimeType2
  };
  console.log('Proxy 요청 시작:', { url, prompt: prompt.substring(0, 50) + '...', hasSecondImage: !!base64Image2 });

  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  console.log('Proxy 응답 상태:', response.status, response.statusText);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Proxy 에러 응답:', errorData);
    
    if (response.status === 402) {
      if (errorData.error === 'BUDGET_EXCEEDED') {
        // 전체 일일 예산 한도 초과
        throw new Error('BUDGET_EXCEEDED');
      } else {
        // 개인 무료 한도 초과
        throw new Error('FREE_LIMIT_EXCEEDED');
      }
    }
    
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const responseData = await response.json();
  console.log('Proxy 응답 데이터:', responseData);
  return responseData; // { imageData, mimeType }
}

function applyOverLimitUI() {
  generateBtn.setAttribute('data-over-limit', '1');
  generateBtn.textContent = '추가 생성은 결제가 필요합니다';
  generateBtn.disabled = false;
  generateBtn.onclick = async () => {
    try {
      // 결제 창 열기
      const payUrl = `${PROXY_BASE_URL}/pay`;
      try {
        if (chrome?.windows?.create) {
          await chrome.windows.create({ url: payUrl, type: 'popup', width: 480, height: 720, focused: true });
        } else if (chrome?.tabs?.create) {
          await chrome.tabs.create({ url: payUrl, active: true });
        } else {
          window.open(payUrl, '_blank', 'width=480,height=720');
        }
      } catch (e) {
        window.open(payUrl, '_blank', 'width=480,height=720');
      }
      // 간단한 폴링으로 결제 완료 감지 후 쿼터 재확인
      const started = Date.now();
      let upgraded = false;
      while (Date.now() - started < 180000) { // 최대 3분 대기
        await new Promise(r => setTimeout(r, 3000));
        const headers = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const resp = await fetch(`${PROXY_BASE_URL}/quota`, { cache: 'no-store', headers });
        if (resp.ok) {
          const data = await resp.json();
          if ((data.isLoggedIn && typeof data.remainingCredits === 'number' && data.remainingCredits > 0) ||
              (!data.isLoggedIn && data.limit && data.limit > (data.baseLimit || 3))) {
            upgraded = true;
            generateBtn.removeAttribute('data-over-limit');
            updateGenerateButton();
            break;
          }
        }
      }
      if (upgraded) {
        showSuccess('크레딧/한도 업그레이드가 확인되었습니다.');
      } else {
        showError('업그레이드가 확인되지 않았습니다. 다시 시도해주세요.');
      }
    } catch (e) {
      showError('결제 처리 중 오류가 발생했습니다.');
    }
  };
}

// 서버 쿼터 조회(일일 30크레딧 제한)
async function checkServerQuota() {
  try {
    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const resp = await fetch(`${PROXY_BASE_URL}/quota`, { method: 'GET', cache: 'no-store', headers });
    if (!resp.ok) return;
    const data = await resp.json();
    remainingCredits = typeof data.remainingCredits === 'number' ? data.remainingCredits : data.remaining;
    if (typeof remainingCredits === 'number' && remainingCredits <= 0) {
      applyOverLimitUI();
    } else {
      generateBtn.removeAttribute('data-over-limit');
    }
    updateGenerateButton();
  } catch (e) {
    // 네트워크 오류 시 UI는 그대로 둠
  }
}

// 다운로드 기능
downloadBtn.addEventListener('click', async () => {
  if (generatedImage.src) {
    const link = document.createElement('a');
    link.download = `generated-image-${Date.now()}.png`;
    link.href = generatedImage.src;
    link.click();
    
    // 다운로드 후 생성된 이미지 삭제
    generatedImageData = null;
    generatedImage.src = '';
    resultSection.style.display = 'none';
    // KV 저장소에서도 삭제
    try {
      await fetch(`${VERCEL_API_BASE}/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'generatedImageData', value: '', ttlSec: 1 }) // 1초 후 만료
      });
    } catch (error) {
      console.error('KV 삭제 실패:', error);
    }
    
    showSuccess('이미지가 다운로드되었습니다.');
  }
});

// 새로 생성 버튼
newGenerationBtn.addEventListener('click', async () => {
  resultSection.style.display = 'none';
  promptInput.value = '';
  
  // 생성된 이미지 삭제
  generatedImageData = null;
  generatedImage.src = '';
  // KV 저장소에서도 삭제
  try {
    await fetch(`${VERCEL_API_BASE}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'generatedImageData', value: '', ttlSec: 1 }) // 1초 후 만료
    });
  } catch (error) {
    console.error('KV 삭제 실패:', error);
  }
  
  // 이미지는 유지하고 프롬프트만 초기화
  updateGenerateButton();
});

// 유틸리티 함수들
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  setTimeout(() => {
    hideError();
  }, 5000);
}

function hideError() {
  errorMessage.style.display = 'none';
}

// 캡처된 스크린샷 확인
async function checkForCapturedScreenshot() {
  try {
    const capturedScreenshot = await kvGet('capturedScreenshot');
    const captureTimestamp = await kvGet('captureTimestamp');
    
    if (capturedScreenshot && captureTimestamp) {
      // 최근 5분 내에 캡처된 이미지인지 확인
      const timeDiff = Date.now() - parseInt(captureTimestamp);
      if (timeDiff < 300000) { // 5분
        console.log('새로운 캡처 발견:', { 
          hasFirstImage: currentScreenshots[0] !== null, 
          hasSecondImage: currentScreenshots[1] !== null 
        });
        
        // 순차적으로 이미지 저장: 첫 번째가 비어있으면 첫 번째에, 아니면 두 번째에
        if (currentScreenshots[0] === null) {
          // 첫 번째 슬롯에 저장
          currentScreenshots[0] = capturedScreenshot;
          screenshot1.src = capturedScreenshot;
          screenshot1.style.display = 'block';
          screenshotPlaceholder1.style.display = 'none';
          clearImage1Btn.style.display = 'block';
          showSuccess('첫 번째 이미지가 저장되었습니다.');
          console.log('첫 번째 슬롯에 저장됨');
        } else if (currentScreenshots[1] === null) {
          // 두 번째 슬롯에 저장
          currentScreenshots[1] = capturedScreenshot;
          screenshot2.src = capturedScreenshot;
          screenshot2.style.display = 'block';
          screenshotPlaceholder2.style.display = 'none';
          clearImage2Btn.style.display = 'block';
          showSuccess('두 번째 이미지가 저장되었습니다.');
          console.log('두 번째 슬롯에 저장됨');
        } else {
          // 두 슬롯이 모두 차있으면 첫 번째를 교체
          currentScreenshots[0] = capturedScreenshot;
          screenshot1.src = capturedScreenshot;
          screenshot1.style.display = 'block';
          screenshotPlaceholder1.style.display = 'none';
          clearImage1Btn.style.display = 'block';
          showSuccess('첫 번째 이미지가 교체되었습니다.');
          console.log('첫 번째 슬롯 교체됨');
        }
        
        // 캡처된 이미지 정보 삭제 (TTL을 1초로 설정하여 즉시 만료)
        await kvSet('capturedScreenshot', '', 1);
        await kvSet('captureTimestamp', '', 1);
        
        // 이미지를 영구 저장
        await saveImages();
        
        updateGenerateButton();
      }
    }
  } catch (error) {
    console.error('캡처된 스크린샷 확인 실패:', error);
  }
}

// 저장된 이미지 복원
async function restoreSavedImages() {
  try {
    // KV 저장소에서 이미지 복원
    const savedImage1 = await kvGet('savedImage1');
    const savedImage2 = await kvGet('savedImage2');
    
    if (savedImage1) {
      currentScreenshots[0] = savedImage1;
      screenshot1.src = savedImage1;
      screenshot1.style.display = 'block';
      screenshotPlaceholder1.style.display = 'none';
      clearImage1Btn.style.display = 'block';
      console.log('첫 번째 이미지 복원됨 (KV)');
    }
    
    if (savedImage2) {
      currentScreenshots[1] = savedImage2;
      screenshot2.src = savedImage2;
      screenshot2.style.display = 'block';
      screenshotPlaceholder2.style.display = 'none';
      clearImage2Btn.style.display = 'block';
      console.log('두 번째 이미지 복원됨 (KV)');
    }
  } catch (error) {
    console.error('저장된 이미지 복원 실패:', error);
  }
}

// 이미지 저장 (KV 저장소에 영구 저장)
async function saveImages() {
  try {
    // KV 저장소에 이미지 저장
    if (currentScreenshots[0]) {
      await kvSet('savedImage1', currentScreenshots[0], 86400); // 24시간 TTL
    }
    if (currentScreenshots[1]) {
      await kvSet('savedImage2', currentScreenshots[1], 86400); // 24시간 TTL
    }
    
    console.log('이미지 저장됨 (KV):', { 
      hasFirstImage: currentScreenshots[0] !== null, 
      hasSecondImage: currentScreenshots[1] !== null 
    });
  } catch (error) {
    console.error('이미지 저장 실패:', error);
  }
}

// 생성된 이미지 저장
async function saveGeneratedImage() {
  try {
    if (generatedImageData) {
      await kvSet('generatedImageData', generatedImageData, 86400); // 24시간 TTL
      console.log('생성된 이미지 저장됨 (KV)');
    }
  } catch (error) {
    console.error('생성된 이미지 저장 실패:', error);
  }
}

// 생성된 이미지 복원
async function restoreGeneratedImage() {
  try {
    const savedGeneratedImage = await kvGet('generatedImageData');
    
    if (savedGeneratedImage) {
      generatedImageData = savedGeneratedImage;
      generatedImage.src = generatedImageData;
      resultSection.style.display = 'block';
      console.log('생성된 이미지 복원됨 (KV)');
    }
  } catch (error) {
    console.error('생성된 이미지 복원 실패:', error);
  }
}

function showSuccess(message) {
  // 간단한 성공 메시지 표시 (실제로는 토스트나 알림을 사용하는 것이 좋습니다)
  console.log('Success:', message);
  
  // 현재 상태도 함께 로그
  console.log('현재 이미지 상태:', { 
    hasFirstImage: currentScreenshots[0] !== null, 
    hasSecondImage: currentScreenshots[1] !== null,
    hasGeneratedImage: generatedImageData !== null,
    firstImageDisplay: screenshot1.style.display,
    secondImageDisplay: screenshot2.style.display,
    firstClearBtnDisplay: clearImage1Btn.style.display,
    secondClearBtnDisplay: clearImage2Btn.style.display,
    resultSectionDisplay: resultSection.style.display
  });
}

// 할당량 업데이트 함수
async function updateQuota() {
  try {
    const headers = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`${SERVER_URL}/quota`, { headers });
    const data = await response.json();
    
    if (data.error) {
      showError('할당량 확인 실패: ' + data.error);
      return;
    }
    
    const elRemaining = document.getElementById('remaining');
    const elLimit = document.getElementById('limit');
    const elRemainingCredits = document.getElementById('remainingCredits');
    const elCreditUnit = document.getElementById('creditUnit');
    const elBudget = document.getElementById('budgetRemaining');
    if (elRemaining) elRemaining.textContent = String(data.remaining);
    if (elLimit) elLimit.textContent = String(data.limit);
    if (elRemainingCredits) elRemainingCredits.textContent = String(data.remainingCredits);
    if (elCreditUnit) elCreditUnit.textContent = String(data.creditUnit);
    if (elBudget) elBudget.textContent = data.budgetRemainingKrw?.toLocaleString?.() || 'N/A';
    
    // 로그인 상태 표시
    const loginStatusElement = document.getElementById('login-status');
    if (loginStatusElement) {
      if (data.isLoggedIn) {
        loginStatusElement.textContent = '로그인됨';
        loginStatusElement.className = 'status-logged-in';
      } else {
        loginStatusElement.textContent = '비로그인';
        loginStatusElement.className = 'status-logged-out';
      }
    }
  } catch (error) {
    console.error('Quota update error:', error);
    showError('할당량 확인 중 오류가 발생했습니다.');
  }
}

// 클라이언트측 IP/사용량 로직 제거(프록시에서 일일 3회 제한을 강제)
