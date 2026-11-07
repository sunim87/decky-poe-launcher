# Decky POE Launcher 0.1.0

[설치 ZIP 다운로드](https://github.com/sunim87/decky-poe-launcher/releases/latest) · [버그 제보](https://github.com/sunim87/decky-poe-launcher/issues)

수정한 POE 스팀덱 런처를 설치하고 Steam 게이밍 모드의 비 Steam 라이브러리에 등록합니다.

## 사용법

1. Steam에서 **Proton 10.0**, **Steam Linux Runtime 3.0 (sniper)**을 설치합니다.
2. Decky 개발자 설정의 ZIP 설치로 플러그인을 설치합니다.
3. 플러그인의 **런처 설치**를 누릅니다. 라이브러리의 **POE2 Launcher**에서 실행합니다.
4. 제거할 때 게임과 런처를 모두 종료하고 **런처 및 라이브러리 제거**를 누릅니다.

설치에는 현재 수정본 런처가 포함되어 있습니다. 원본 GitHub 자동 업데이트를 사용하면 로컬 수정본이 바뀔 수 있으므로 배포 저장소 분리는 별도 작업입니다. 이 플러그인은 릴리스를 자동 게시하지 않습니다.

## 포함 내용

- 홈페이지 변경 및 설치 감지 수정, 카카오 직접 실행
- 홈페이지/거래소 모양의 LSFG-VK·MAKO 상호 배타 토글
- OptiScaler 0.9.4 + FSR 4.1.2 INT8 Lite 설치/해제
- 게임만 종료한 후 같은 런처에서 다시 시작하는 문제 수정
- Steam 바로가기, 세로/가로 표지·배경·로고·아이콘 자동 등록과 제거

LSFG-VK·MAKO는 해당 Vulkan 레이어와 원래 설정이 설치되어 있어야 합니다. 이 플러그인은 두 레이어 자체를 설치하지 않습니다. FSR Lite는 실기기에서 검증했던 시험 DLL을 포함합니다.

## 파일과 제거 범위

런처: `~/Applications/POE2-Launcher/launcher/`.

공유 Proton 환경: `~/Applications/POE2-Launcher/compatdata/`.

제거는 관리한 런처, 실행 스크립트, 라이브러리 바로가기와 이미지에 한정합니다. **POE1/POE2 게임, 계정 설정, 저장 데이터와 Proton 환경은 보존합니다.** 기존 런처 등록을 설치/복구로 가져온 경우 이전 Windows 런처 프로그램 폴더도 제거하며 게임 폴더는 건드리지 않습니다. 플러그인 ZIP만 Decky에서 지우는 동작은 런처 제거 버튼과 다릅니다.

설치/이미지 등록이 중간에 실패하면 설치/복구로 다시 시도할 수 있습니다. Steam 라이브러리 저장을 기다리라는 메시지는 잠시 후 제거를 재시도하면 됩니다.

이미지는 기존 런처의 POE2 이미지에서 구성하고 PNG 색상 압축을 적용했습니다. 이미지 권리는 원 권리자에게 있습니다. Steam API 등록 방식은 기존 Decky Web Games 작업을 참고했습니다.

## 개발

`npm install`, `npm run typecheck`, `npm run build`.

`python -m unittest discover -s tests`.

`launcher-source/`는 수정 런처의 소스입니다. 런처의 원 라이선스는 해당 폴더의 `LICENSE`에 있습니다. 플러그인 자체는 MIT 라이선스입니다.

런처 빌드용 외부 DLL을 복구하려면 릴리스 설치 ZIP을 받은 뒤 `python scripts/restore_assets.py Decky-POE-Launcher-v0.1.0.zip`을 실행합니다. 이어 `launcher-source/`에서 `npm ci`, `npm run build:check` 후 electron-builder로 Windows 폴더 패키지를 만듭니다. 배포 폴더를 `python scripts/package.py <win-unpacked 경로>`로 전달합니다.

버그 제보: https://github.com/sunim87/decky-poe-launcher/issues
