# Decky POE Launcher 0.1.0

[설치 ZIP 다운로드](https://github.com/sunim87/decky-poe-launcher/releases/latest) · [버그 제보](https://github.com/sunim87/decky-poe-launcher/issues)

수정한 POE 스팀덱 런처를 설치하고 Steam 게이밍 모드의 비 Steam 라이브러리에 등록합니다.

## 사용법

1. Decky 개발자 설정의 ZIP 설치로 플러그인을 설치합니다.
2. 플러그인의 **런처 설치**를 누릅니다. **Proton 10.0**, **Steam Linux Runtime 3.0 (sniper)**이 없으면 Steam으로 함께 설치하고, 완료 후 런처 설치와 라이브러리 등록을 이어갑니다.
3. 라이브러리의 **POE2 Launcher**에서 실행합니다.
4. 제거할 때 게임과 런처를 모두 종료하고 **런처 및 라이브러리 제거**를 누릅니다.

설치에는 현재 수정본 런처와 런처 전용 자동 업데이트 지원이 포함됩니다. 업데이트 대상은 이 저장소의 런처 파일이며, Decky 플러그인 자체를 자동 교체하지 않습니다.

이미 설치된 필수 도구는 재설치하지 않으며, 다른 Steam 라이브러리에 설치된 도구도 인식합니다. 설치 중에는 Steam을 온라인 상태로 두고 다운로드를 재개해 주세요. Steam이 이용약관을 표시하면 해당 창에서 확인하면 됩니다. 런처 제거 시 공유 도구인 Proton과 Steam Linux Runtime은 유지합니다.

## 포함 내용

- 런처 자체 자동 업데이트: 새 버전 확인·다운로드·안전한 적용
- 홈페이지 변경 및 설치 감지 수정, 카카오 직접 실행
- 홈페이지/거래소 모양의 LSFG-VK·MAKO 상호 배타 토글
- OptiScaler 0.9.4 + FSR 4.1.2 INT8 Lite 설치/해제
- 게임만 종료한 후 같은 런처에서 다시 시작하는 문제 수정
- Steam 바로가기, 세로/가로 표지·배경·로고·아이콘 자동 등록과 제거

LSFG-VK·MAKO는 해당 Vulkan 레이어와 원래 설정이 설치되어 있어야 합니다. 이 플러그인은 두 레이어 자체를 설치하지 않습니다. FSR Lite는 실기기에서 검증했던 시험 DLL을 포함합니다.

### LSFG-VK·MAKO 버전과 적용 설정

2026-11-07 스팀덱에서 확인한 구성입니다. 아래 Decky 플러그인은 별도 설치 항목이며, 런처 설치 ZIP에 포함된 버전을 뜻하지 않습니다.

| 항목 | LSFG-VK | MAKO |
|---|---|---|
| 검증한 Decky 플러그인 버전 | Decky LSFG-VK **0.14.4** | MAKO **4.6.0** |
| 런타임/설정 형식 | LSFG-VK 레이어 **2.0.0**, TOML `version = 2` | MAKO Renderer, TOML `version = 2` |
| 프레임 생성 배율 | 기본 **2배**, 런처 설정에서 2/3/4배 선택 | 같은 배율 설정 사용 |
| 성능 모드 | `performance_mode = true` | `performance_mode = true` |
| 흐름 해상도 비율 | `flow_scale = 0.65` | `flow_scale = 0.65` |
| FP16 | 기존 전역 설정 유지, 검증 기기는 `allow_fp16 = true` | 기존 전역 설정 유지, 검증 기기는 `allow_fp16 = true` |
| 추가 설정 | `preserve_swapchain_image_count = true` | `scaling_enabled = false`, `adaptive = false`, `pacing = "none"` |

- 두 버튼은 상호 배타적으로 동작합니다. 하나를 ON으로 선택하면 다른 엔진은 OFF가 되며, 둘 다 OFF도 가능합니다. 변경 사항은 다음 게임 실행에 적용됩니다.
- 게임 실행 때 기존 `~/.config/lsfg-vk/conf.toml` 또는 `~/.config/mako-render/conf.toml`을 복사해 **POE Launcher Frame Generation** 전용 프로필을 추가합니다. 기존 전역 설정 파일은 덮어쓰지 않습니다.
- FP16은 복사한 전역 설정을 따릅니다. 다른 기기에서 자동으로 FP16을 켜는 설정은 아닙니다.
- MAKO 선택 시 `frame_generation_provisioned = true`, `frame_generation_enabled = true`를 적용하고 공간 업스케일링은 끕니다. 실행 환경의 HDR 노출 보정과 Steam Vulkan 오버레이도 비활성화합니다.
- 각 엔진이 참조하는 Lossless Scaling DLL은 기존 설치 설정을 그대로 사용합니다. 두 엔진의 DLL 파일을 서로 교체하지 않습니다.

## 런처 자동 업데이트

런처 시작 시 이 저장소의 최신 릴리스에서 런처 전용 정보를 확인합니다. 새 버전이면 자동 다운로드하고 SHA-256을 검증한 뒤 런처 프로그램 폴더만 교체합니다. 실행 중 새 버전을 발견하면 다운로드를 준비하고, 업데이트 후 재시작 또는 다음 런처 실행 때 적용합니다. 게임이 켜져 있을 때는 적용을 차단합니다.

네트워크/검증 실패 시 기존 런처를 실행하며, 교체 중단 시 이전 런처를 복구합니다. 게임 파일·설정·라이브러리·이미지와 Decky 플러그인은 업데이트 대상으로 삼지 않습니다. 구버전 플러그인의 설치/복구로 최신 런처를 덮어쓰지 않도록 보호합니다.

처음 자동 업데이트 지원을 설치할 때는 이번 ZIP으로 한 번 설치/복구해야 합니다. 이후에는 매번 Decky 플러그인을 재설치할 필요가 없습니다.

실제 스팀덱에서 GitHub 다운로드와 ‘재시작하여 설치’로 `1.4.2-sd.21` 적용을 확인했습니다. 최신 버전의 중복 다운로드 방지와 기존 게임 데이터 보존도 확인했습니다. 통합 이전 설치 파일로 복구하면 자동 업데이트 지원이 사라질 수 있으므로, 복구할 때는 현재 릴리스의 설치 ZIP을 사용하세요.

배포자는 빌드 번호를 올리고 `scripts/package.py`와 `scripts/publish.py release`로 릴리스를 만들면 런처 ZIP과 `launcher-update.json`이 함께 올라갑니다. 플러그인 ZIP만 수동 업로드하면 런처 업데이트 정보가 생성되지 않습니다.

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
