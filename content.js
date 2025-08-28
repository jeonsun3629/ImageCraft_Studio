// 콘텐츠 스크립트 - 이미지 감지 및 복사 기능
console.log('ImageCraft Studio 콘텐츠 스크립트가 로드되었습니다.');
console.log('현재 페이지:', window.location.href);

// 이미지 감지 관련 변수들
let isImageDetectionActive = false;
let highlightedImage = null;
let imageOverlay = null;

// 페이지와의 통신을 위한 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  if (request.action === 'ping') {
    // ping 응답으로 콘텐츠 스크립트가 로드되어 있음을 확인
    sendResponse({ success: true, message: 'Content script is loaded' });
  } else if (request.action === 'getPageInfo') {
    // 페이지 정보 반환
    sendResponse({
      title: document.title,
      url: window.location.href,
      timestamp: Date.now()
    });
  } else if (request.action === 'startImageDetection') {
    // 이미지 감지 시작
    console.log('Starting image detection...');
    startImageDetection();
    sendResponse({ success: true });
  } else if (request.action === 'stopImageDetection') {
    // 이미지 감지 중지
    console.log('Stopping image detection...');
    stopImageDetection();
    sendResponse({ success: true });
  }
});

// 이미지 감지 시작
function startImageDetection() {
  if (isImageDetectionActive) return;
  
  isImageDetectionActive = true;
  
  // 이벤트 리스너 추가
  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('mouseout', handleMouseOut);
  document.addEventListener('click', handleImageClick);
  document.addEventListener('keydown', handleKeyDown);
  
  // 안내 메시지 표시
  showInstructionMessage();
  
  console.log('이미지 감지 모드 시작');
}

// 이미지 감지 중지
function stopImageDetection() {
  if (!isImageDetectionActive) return;
  
  isImageDetectionActive = false;
  
  // 이벤트 리스너 제거
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleImageClick);
  document.removeEventListener('keydown', handleKeyDown);
  
  // 하이라이트 제거
  removeImageHighlight();
  
  // 안내 메시지 제거
  removeInstructionMessage();
  
  console.log('이미지 감지 모드 종료');
}

// 안내 메시지 표시
function showInstructionMessage() {
  const message = document.createElement('div');
  message.id = 'image-detection-instruction';
  message.textContent = '이미지에 마우스를 올리고 클릭하면 자동으로 복사됩니다. ESC로 취소';
  message.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 2147483647;
    font-family: Arial, sans-serif;
    font-size: 14px;
    pointer-events: none;
  `;
  document.body.appendChild(message);
  
  // 5초 후 메시지 제거
  setTimeout(() => {
    removeInstructionMessage();
  }, 5000);
}

// 안내 메시지 제거
function removeInstructionMessage() {
  const message = document.getElementById('image-detection-instruction');
  if (message) {
    message.remove();
  }
}

// 이미지 하이라이트 생성
function createImageHighlight(img) {
  if (imageOverlay) {
    imageOverlay.remove();
  }
  
  const rect = img.getBoundingClientRect();
  imageOverlay = document.createElement('div');
  imageOverlay.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: 3px solid #00ff00;
    background: rgba(0, 255, 0, 0.1);
    z-index: 2147483646;
    pointer-events: none;
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
  `;
  
  document.body.appendChild(imageOverlay);
}

// 이미지 하이라이트 제거
function removeImageHighlight() {
  if (imageOverlay) {
    imageOverlay.remove();
    imageOverlay = null;
  }
  highlightedImage = null;
}

// 마우스 오버 이벤트
function handleMouseOver(e) {
  if (!isImageDetectionActive) return;
  
  const target = e.target;
  if (target.tagName === 'IMG' && target.src) {
    highlightedImage = target;
    createImageHighlight(target);
  }
}

// 마우스 아웃 이벤트
function handleMouseOut(e) {
  if (!isImageDetectionActive) return;
  
  const target = e.target;
  if (target === highlightedImage) {
    removeImageHighlight();
  }
}

// 이미지 클릭 이벤트
function handleImageClick(e) {
  if (!isImageDetectionActive || !highlightedImage) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  // 이미지 복사
  copyImageToExtension(highlightedImage);
  
  // 이미지 감지 모드 종료
  stopImageDetection();
}

// 키보드 이벤트 (ESC로 취소)
function handleKeyDown(e) {
  if (e.key === 'Escape' && isImageDetectionActive) {
    stopImageDetection();
  }
}

// 이미지를 확장프로그램으로 복사
async function copyImageToExtension(img) {
  try {
    console.log('이미지 복사 중:', img.src);
    
    // 이미지 URL을 확장프로그램으로 전송
    const response = await chrome.runtime.sendMessage({
      action: 'copyImageToExtension',
      imageUrl: img.src,
      imageAlt: img.alt || '이미지',
      imageWidth: img.naturalWidth || img.width,
      imageHeight: img.naturalHeight || img.height
    });
    
    if (response.success) {
      console.log('이미지 복사 완료');
    } else {
      console.error('이미지 복사 실패:', response.error);
    }
  } catch (error) {
    console.error('이미지 복사 중 오류:', error);
  }
}

// 페이지 로드 완료 시 알림
document.addEventListener('DOMContentLoaded', () => {
  console.log('페이지가 로드되었습니다:', window.location.href);
});
