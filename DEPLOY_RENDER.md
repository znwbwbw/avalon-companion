# Render 배포 안내 · Avalon Companion v1.2

## GitHub 저장소 만들기
1. VS Code에서 프로젝트 폴더를 엽니다. 기존 v1.1 프로젝트를 덮어쓰지 말고 새 폴더로 테스트하세요.
2. VS Code 소스 제어에서 GitHub 저장소를 새로 게시하거나 `git init`, `git add .`, `git commit -m "Avalon v1.2"` 후 원격 저장소에 push 합니다.
3. `.env`, 토큰 등의 비밀 정보는 저장소에 업로드하지 마세요.

## Render에 배포
1. https://dashboard.render.com/ 에서 GitHub 계정을 연결합니다.
2. New → Blueprint 메뉴에서 위 저장소를 선택하면 `render.yaml`을 읽어 웹 서비스 생성이 가능합니다. (또는 New → Web Service 설정)
3. 직접 생성 시: Runtime Node / Build Command `npm install` / Start Command `npm start` / Health Check Path `/health` / 환경 변수 `NODE_ENV=production` 설정.
4. 배포가 완료되면 발급된 `https://...onrender.com` 주소에 접속합니다. 참가자가 동일 링크로 접속하면 됩니다.
5. PC와 다른 네트워크의 스마트폰으로 방 생성, 참가, 재접속과 투표를 실험합니다.

## 반드시 알아야 할 제한
- 이 버전은 **메모리 저장**입니다. 서버가 재시작·재배포·휴면 전환되면 모든 게임 방이 삭제됩니다. **실제 행사 운영 전에 DB 영속화가 필요합니다.**
- Render 무료 인스턴스는 유휴 시 중단되고 재시작에 시간이 걸립니다. 최초 접속에 지연이 생길 수 있습니다.
- 웹소켓 연결을 유지하기 위해 서버 ping을 추가했지만 무중단 서비스를 보장하지 않습니다.
- 공개 URL 배포 전 초대 코드 공격 방지, 접근 제한, 서버 로그, 사용자 인증, 데이터 보관 정책을 검토하세요.
- 이 파일은 배포 설정 준비이며 실제 Render / GitHub에 업로드하거나 URL을 발급한 것은 아닙니다.

## 로컬 확인
```powershell
npm.cmd install
npm.cmd run dev
```
접속: http://localhost:3000 / 헬스체크: http://localhost:3000/health
