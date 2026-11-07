<p align="center">
  <img src="src/renderer/assets/layout/frame-top-center.gif" width="100%" />
</p>

<h1 align="center">POE Unofficial Launcher SD — 스팀덱 버전</h1>

<p align="center">
  <img src="https://img.shields.io/github/v/release/psp3322/POE2-unofficial-launcher-for-steamdeck?include_prereleases&style=flat-square" />
  <img src="https://img.shields.io/github/license/psp3322/POE2-unofficial-launcher-for-steamdeck?style=flat-square" />
  <img src="https://img.shields.io/github/downloads/psp3322/POE2-unofficial-launcher-for-steamdeck/total?style=flat-square" />
</p>

<p align="center">
  <a href="README.md"><b>한국어</b></a> | <a href="docs/README_EN.md"><b>English</b></a>
</p>

**Path of Exile 1·2 (카카오게임즈)** 를 **스팀덱**에서 실행하기 위한 비공식 런처입니다.
[NERDHEAD-lab/POE2-unofficial-launcher](https://github.com/NERDHEAD-lab/POE2-unofficial-launcher)를 스팀덱(Proton/Wine)에서 동작하도록 수정한 포크입니다.

> ⚠️ **비공식** 런처입니다. 카카오게임즈·Grinding Gear Games와 무관하며, 사용에 따른 책임은 본인에게 있습니다.

## 스팀덱에서 되는 것

- **카카오 로그인 자동화** — 지정 PC 확인, 로그인 팝업, 인트로를 자동 처리
- **카카오 스타터 없이 게임 실행** — 스팀덱에는 KakaoGamesStarter가 없어 원본 방식이 동작하지 않는데, 이 포크는 런처가 실행 토큰을 직접 가로채 게임을 바로 실행합니다
- **랜덤숫자(compatdata) 수작업 불필요** — 설치파일을 스팀에 등록한 그대로 계속 실행하면 됩니다. 재실행 시 설치된 런처가 자동으로 뜹니다
- **게임 자동 탐지** — 다른 스팀 항목(프리픽스)이나 SD카드에 이미 설치된 POE1/POE2를 알아서 찾습니다. 없으면 런처 안에서 공식 설치 프로그램을 바로 실행합니다
- **덱 맞춤 UI** — 1280×800 풀스크린, 게임패드 내비게이션(D패드/A/B), X 버튼 = 완전 종료
- **🦆 Lossless Scaling(lsfg-vk) 프레임 생성 토글** — 메인 화면 오리 버튼으로 켜고 끄기 (게임에만 적용되어 런처 크래시 없음)
- **자동 업데이트** — 이 저장소 Releases에서 새 버전을 받아 자동 적용

## 설치 방법

1. 스팀덱을 **데스크탑 모드**로 전환
2. [Releases](https://github.com/psp3322/POE2-unofficial-launcher-for-steamdeck/releases)에서 최신 `POE2-Unofficial-Launcher-Setup-....exe` 다운로드
3. 데스크탑 모드의 Steam에서 **"비 Steam 게임 추가"**로 다운받은 파일 추가
4. 추가한 게임 속성 → 호환 → **Proton Experimental (권장)** 또는 Proton 9.0 이상 강제 지정
5. 실행하면 설치가 자동으로 진행되고 런처가 뜹니다 — **여기서 끝!** 경로 수정 없이 이후에도 같은 바로가기만 실행하면 됩니다
6. 게임 모드로 전환 → 런처에서 카카오 로그인 → 게임 시작

자세한 사용법·문제 해결·추천 그래픽 설정은 **[스팀덱 가이드](docs/README_STEAMDECK.md)** 를 참고하세요.

## 알아둘 것

- **Decky Lossless Scaling을 스팀 실행옵션으로 걸지 마세요** — 런처까지 후킹되어 게임이 실행 직후 꺼집니다. 대신 런처 메인 화면의 🦆 토글을 사용하세요
- 폰트 교체(시스템 폰트 설치) 기능은 Windows API 의존이라 스팀덱에서는 비활성화됩니다
- 버그 제보·기능 건의: [Issues](https://github.com/psp3322/POE2-unofficial-launcher-for-steamdeck/issues) (런처 안 "기능 건의" 버튼도 여기로 연결됩니다)

## 크레딧

- 원본 런처: [NERDHEAD-lab/POE2-unofficial-launcher](https://github.com/NERDHEAD-lab/POE2-unofficial-launcher) — 카카오 자동화의 모든 기반
- 직접 실행 방식의 원조: Dr.Sashimi님의 poe2-kakao-launcher, [psp3322/poe1-kakao-launcher](https://github.com/psp3322/poe1-kakao-launcher)
- 라이선스: [AGPL-3.0](LICENSE) (원본과 동일)
