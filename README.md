# ImageCraft Studio Chrome Extension

Google의 Gemini 2.5 Flash Preview Image API를 사용하여 스크린샷을 기반으로 이미지를 생성하는 크롬 확장프로그램입니다.

## 주요 기능

1. **화면 스크린샷 기능**: 현재 활성 탭의 스크린샷을 캡처
2. **자동 입력**: 캡처된 스크린샷이 확장프로그램에 자동으로 표시
3. **프롬프트 입력**: 이미지 생성을 위한 텍스트 프롬프트 입력
4. **API 연동**: Gemini 2.5 Flash Preview Image API를 사용한 이미지 생성
5. **결과 표시**: 생성된 이미지를 확장프로그램에서 확인
6. **다운로드**: 생성된 이미지를 로컬에 저장

## 설치 방법

### 1. Firebase 프로젝트 설정
1. [Firebase Console](https://console.firebase.google.com/)에서 새 프로젝트 생성
2. **Authentication** 활성화 (이메일/비밀번호)
3. **Firestore Database** 생성
4. **Project Settings** → **Service accounts** → **Generate new private key** 다운로드
5. 다운로드한 JSON 파일의 내용을 환경변수로 설정

### 2. 프로젝트 다운로드
```bash
git clone [repository-url]
cd nanoBextention
```

### 3. 환경변수 설정
```bash
cd server
cp env.example .env
```

`.env` 파일을 편집하여 다음 정보를 입력:
- `GEMINI_API_KEY`: Google Gemini API 키
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: PayPal Live 계정 정보
- `JWT_SECRET`: JWT 토큰 암호화 키
- Firebase 서비스 계정 정보 (JSON 파일에서 추출)

### 4. 의존성 설치
```bash
cd server
npm install
```

### 5. Chrome 확장프로그램 설치
1. Chrome 브라우저에서 `chrome://extensions/` 접속
2. 우측 상단의 "개발자 모드" 토글 활성화
3. "압축해제된 확장프로그램을 로드합니다" 버튼 클릭
4. 프로젝트 폴더 선택

## 사용 방법

### 1. API 키 설정
1. [Google AI Studio](https://aistudio.google.com/)에서 Gemini API 키 발급
2. 확장프로그램 팝업에서 API 키 입력
3. "API 키 저장" 버튼 클릭

### 2. 이미지 생성
1. 확장프로그램 아이콘 클릭하여 팝업 열기
2. "스크린샷 캡처" 버튼 클릭하여 현재 페이지 스크린샷
3. 프롬프트 입력란에 원하는 이미지 설명 입력
4. "이미지 생성" 버튼 클릭
5. 생성 완료 후 "다운로드" 버튼으로 이미지 저장

## 파일 구조

```
nanoBextention/
├── manifest.json          # 확장프로그램 설정 파일
├── popup.html            # 팝업 UI
├── popup.css             # 팝업 스타일
├── popup.js              # 팝업 로직
├── background.js         # 백그라운드 서비스 워커
├── content.js            # 콘텐츠 스크립트

├── icons/                # 아이콘 폴더
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # 프로젝트 설명서
```

## 기술 스택

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Chrome Extension API**: Manifest V3
- **AI API**: Google Gemini 2.5 Flash Preview Image API
- **이미지 처리**: Canvas API, Base64 인코딩

## API 설정

### Gemini API 키 발급
1. [Google AI Studio](https://aistudio.google.com/) 접속
2. Google 계정으로 로그인
3. API 키 생성 및 복사
4. 확장프로그램에 입력

### API 사용량
- Gemini 2.5 Flash Preview Image API는 현재 프리뷰 단계
- 사용량 제한 및 비용이 발생할 수 있음
- [Google AI Studio 가격 정책](https://aistudio.google.com/pricing) 참조

## 주의사항

1. **API 키 보안**: API 키는 로컬 저장소에 암호화되지 않은 상태로 저장됩니다
2. **이미지 품질**: 생성된 이미지의 품질은 프롬프트와 원본 스크린샷에 따라 달라집니다
3. **네트워크 연결**: 이미지 생성 시 인터넷 연결이 필요합니다
4. **브라우저 호환성**: Chrome 브라우저에서만 작동합니다

## 문제 해결

### 스크린샷 캡처 실패
- 확장프로그램에 `activeTab` 권한이 있는지 확인
- Chrome 확장프로그램 페이지에서는 캡처가 제한될 수 있음

### API 호출 실패
- API 키가 올바르게 설정되었는지 확인
- 네트워크 연결 상태 확인
- API 사용량 한도 확인

### 이미지 생성 실패
- 프롬프트가 명확하고 구체적인지 확인
- 원본 스크린샷의 품질 확인
- API 응답 시간이 길어질 수 있으므로 기다려주세요

## 개발 정보

- **버전**: 1.0.0
- **최종 업데이트**: 2024년
- **라이선스**: MIT License

## 기여하기

버그 리포트나 기능 제안은 이슈로 등록해주세요.

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.
