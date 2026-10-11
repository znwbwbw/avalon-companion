# v1.28 — 외부 배포 준비
- v1.27의 캐릭터 카드와 게임 진행 로직 유지
- Render 상시 Node.js + WebSocket 배포 가이드 추가 (`DEPLOY_START_HERE_한국어.md`)
- 배포 중 내부 LAN 주소 노출 방지 (`/network-addresses`는 NODE_ENV=production에서 빈 배열 반환)
- 역할 카드 WebP MIME 타입 설정
- 앱 자체의 공개 배포/URL 발급은 Render에서 사용자 계정 연결 후 진행해야 함
