# 런처 소스와 외부 구성

- 원본: https://github.com/NERDHEAD-lab/POE2-unofficial-launcher
- 스팀덱 포크 기반: https://github.com/psp3322/POE2-unofficial-launcher-for-steamdeck (`v1.4.2-sd.19`)
- 현재 수정 소스: 이 저장소의 `launcher-source/`
- 런처 원 라이선스: `launcher-source/LICENSE` (AGPL-3.0)
- 플러그인 코드: 루트 `LICENSE` (MIT)
- Steam 라이브러리 등록 흐름 참고: https://github.com/sunim87/decky-web-games

수정 내용은 홈페이지 변경 대응, 설치 감지, Proton 게임 실행 환경, LSFG/MAKO 선택, OptiScaler+FSR Lite 설치/해제, 반복 실행, 워터마크 설정, 제보 주소입니다.

외부 Windows DLL은 Git 소스에 중복 저장하지 않고 설치 ZIP의 `bin/launcher.zip`에 포함했습니다. `scripts/restore_assets.py`가 `bin/release.json`의 SHA-256으로 확인한 뒤 빌드용 파일을 복구합니다. FSR 업스케일러는 이전 실기기 시험에서 사용한 SDK 2.4 / FSR 4.1.2 INT8 Lite 전용 시험 파일이며, 원 권리자의 라이선스 문서는 묶음의 `Licenses`에 있습니다.

런처 빌드는 Node.js와 Windows Electron 빌드 환경이 필요합니다. 리소스 복구 뒤 `launcher-source`에서 `npm ci`, `npm run build:check`를 실행하고 electron-builder `--dir --win --x64`로 폴더 패키지를 생성합니다. 플러그인은 루트에서 `npm install`, `npm run build`로 만들며 `scripts/package.py`로 둘을 묶습니다.
