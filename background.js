// 백그라운드 서비스 워커
chrome.runtime.onInstalled.addListener(() => {
  console.log('ImageCraft Studio 확장프로그램이 설치되었습니다.');
});

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureScreenshot') {
    captureScreenshot().then(sendResponse);
    return true; // 비동기 응답을 위해 true 반환
  } else if (request.action === 'captureSelectedArea') {
    captureSelectedArea(request.area).then(sendResponse);
    return true;
  } else if (request.action === 'startImageDetection') {
    startImageDetection(request.tabId).then(sendResponse);
    return true;
  } else if (request.action === 'copyImageToExtension') {
    copyImageToExtension(request).then(sendResponse);
    return true;
  }
});

// 스크린샷 캡처 함수
async function captureScreenshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('활성 탭을 찾을 수 없습니다.');
    }

    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 90
    });

    return { success: true, dataUrl: screenshotDataUrl };
  } catch (error) {
    console.error('스크린샷 캡처 실패:', error);
    return { success: false, error: error.message };
  }
}

// 선택된 영역 캡처
async function captureSelectedArea(area) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('활성 탭을 찾을 수 없습니다.');
    }

    // 전체 화면 캡처
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 90
    });

    // Canvas를 사용하여 선택된 영역만 추출
    const img = new Image();
    img.src = screenshotDataUrl;
    
    return new Promise((resolve, reject) => {
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = area.width;
        canvas.height = area.height;
        
        // 선택된 영역만 그리기
        ctx.drawImage(img, area.left, area.top, area.width, area.height, 0, 0, area.width, area.height);
        
        const croppedDataUrl = canvas.toDataURL('image/png');
        
        // 캡처된 이미지를 storage에 저장
        await chrome.storage.local.set({ 
          capturedScreenshot: croppedDataUrl,
          captureTimestamp: Date.now()
        });
        // 캡처 완료 후 팝업 자동 열기
        await openExtensionPopup();
        
        resolve({ success: true, dataUrl: croppedDataUrl });
      };
      
      img.onerror = () => {
        reject(new Error('이미지 로드 실패'));
      };
    });
  } catch (error) {
    console.error('영역 캡처 실패:', error);
    return { success: false, error: error.message };
  }
}

// 이미지 감지 시작
async function startImageDetection(tabId) {
  try {
    console.log('이미지 감지 시작 요청:', tabId);
    
    // 먼저 콘텐츠 스크립트가 주입되어 있는지 확인하고, 없으면 주입
    try {
      console.log('콘텐츠 스크립트 연결 확인 중...');
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      console.log('콘텐츠 스크립트가 이미 로드되어 있습니다.');
    } catch (error) {
      // 콘텐츠 스크립트가 없으면 주입
      console.log('콘텐츠 스크립트 주입 중...');
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      // 주입 후 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('콘텐츠 스크립트 주입 완료');
    }

    // 콘텐츠 스크립트에 이미지 감지 시작 메시지 전송
    console.log('이미지 감지 시작 메시지 전송 중...');
    await chrome.tabs.sendMessage(tabId, { action: 'startImageDetection' });
    console.log('이미지 감지 시작 성공');
    return { success: true };
  } catch (error) {
    console.error('이미지 감지 시작 실패:', error);
    return { success: false, error: error.message };
  }
}

// 이미지를 확장프로그램으로 복사
async function copyImageToExtension(request) {
  try {
    console.log('이미지 복사 요청:', request);
    
    // 이미지 URL을 base64로 변환
    const imageDataUrl = await fetchImageAsDataURL(request.imageUrl);
    
    // 확장프로그램 storage에 저장
    await chrome.storage.local.set({ 
      capturedScreenshot: imageDataUrl,
      captureTimestamp: Date.now()
    });
    // 이미지 복사 완료 후 팝업 자동 열기
    await openExtensionPopup();
    
    return { success: true, dataUrl: imageDataUrl };
  } catch (error) {
    console.error('이미지 복사 실패:', error);
    return { success: false, error: error.message };
  }
}

// 이미지 URL을 base64로 변환
async function fetchImageAsDataURL(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('이미지 변환 실패:', error);
    throw error;
  }
}

// 확장프로그램 아이콘 클릭 시 팝업 열기
chrome.action.onClicked.addListener((tab) => {
  // manifest.json에서 default_popup이 설정되어 있으므로 자동으로 팝업이 열립니다.
  console.log('확장프로그램 아이콘이 클릭되었습니다.');
});

// 팝업 열기 유틸리티 (가능하면 action.openPopup, 아니면 별도 창)
async function openExtensionPopup() {
  try {
    if (chrome.action && chrome.action.openPopup) {
      await chrome.action.openPopup();
      return;
    }
  } catch (e) {
    // fallback below
  }
  try {
    const url = chrome.runtime.getURL('popup.html');
    await chrome.windows.create({ url, type: 'popup', width: 520, height: 900, focused: true });
  } catch (e) {
    console.error('팝업 열기 실패:', e);
  }
}
