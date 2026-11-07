!include "FileFunc.nsh"

; [SteamDeck] 이미 설치된 런처가 있으면 재설치 대신 런처를 바로 실행하는 스텁.
;
; 반드시 preInit(installer .onInit의 가장 첫 단계)에서 처리해야 한다.
; electron-builder의 "앱 실행 중" 검사(ALLOW_ONLY_ONE_INSTALLER_INSTANCE /
; _CHECK_APP_RUNNING)는 customInit보다 먼저 실행되는데, Wine/Proton에는
; 프로세스를 죽이는 nsProcess 플러그인이 동작하지 않아 실행 중인 런처를
; 종료하지 못하고 "앱을 수동으로 닫아라(appCannotBeClosed)" 대화상자가
; 무한 루프에 빠진다. 스팀 게임 모드에서는 이 대화상자가 보이지도 않는다.
; preInit에서 미리 Exec + Quit 하면 그 검사에 도달하기 전에 빠져나온다.
;
; 예외: electron-updater 자동 업데이트는 --updated 인자(또는 /S 무음 설치)로
; 설치파일을 실행하므로 이 경우에는 스텁을 건너뛰고 설치를 진행해야 한다.
; (스텁이 가로채면 업데이트가 영원히 적용되지 않는다)
!macro preInit
  IfSilent poe2StubDone
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  IfErrors 0 poe2StubDone

  ; 설치 위치는 electron-builder가 이전 설치 때 기록한다. Wine에서는 32/64비트
  ; 레지스트리 뷰가 어긋날 수 있으므로 양쪽을 시도하고, 레지스트리가 없으면
  ; 기본 설치 경로($LOCALAPPDATA\Programs)까지 확인한다.
  SetRegView 64
  ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  IfFileExists "$R2\${PRODUCT_FILENAME}.exe" poe2StubLaunch
  SetRegView 32
  ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  SetRegView 64
  IfFileExists "$R2\${PRODUCT_FILENAME}.exe" poe2StubLaunch
  StrCpy $R2 "$LOCALAPPDATA\Programs\${PRODUCT_FILENAME}"
  IfFileExists "$R2\${PRODUCT_FILENAME}.exe" poe2StubLaunch poe2StubDone
poe2StubLaunch:
  SetOutPath "$R2"
  Exec '"$R2\${PRODUCT_FILENAME}.exe"'
  Quit
poe2StubDone:
!macroend

; electron-builder 기본 "앱 실행 중" 검사(_CHECK_APP_RUNNING)를 통째로 교체한다.
; 기본 구현은 nsProcess 플러그인으로 프로세스를 찾고 죽이는데, Wine/Proton에서
; 종료가 실패하면 "cannot be closed. Please close it manually" 재시도 루프에
; 빠지고, 스팀 게임 모드에선 그 대화상자가 보이지 않아 설치가 멈춘 것처럼 보인다.
; 여기서는 Wine에도 있는 taskkill로 조용히 종료 시도만 하고 절대 블로킹하지 않는다.
; (이 매크로는 설치기와 언인스톨러 양쪽의 CHECK_APP_RUNNING을 대체한다)
!macro customCheckAppRunning
  DetailPrint "Closing running instance if any..."
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Pop $R9
  Sleep 1000
!macroend

!macro customInit
  ; 실행 중 인스턴스 종료는 customCheckAppRunning(설치 섹션에서 호출)이 담당한다
!macroend

!macro customInstall
  ; [SteamDeck] 스텁이 읽을 수 있도록 설치 위치를 HKCU 양쪽 레지스트리 뷰에
  ; 직접 기록한다. electron-builder도 InstallLocation을 쓰지만 Wine에서 뷰가
  ; 어긋나는 경우를 대비한 belt-and-suspenders.
  SetRegView 64
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  SetRegView 32
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  SetRegView 64
!macroend

!macro customUnInit
  ; 실행 중 인스턴스 종료는 customCheckAppRunning(언인스톨러 초기화에서 호출)이 담당한다
  ; Verification: UAC disable logic moved to customUnInstall to support reinstall/update scenarios.
!macroend

!macro customUnInstall
  ; 3. Ask user about deleting AppData (Settings, Logs, Cache)
  MessageBox MB_ICONQUESTION|MB_YESNO "설정 파일 및 사용자 데이터(%AppData%\${PRODUCT_FILENAME})를 모두 삭제하시겠습니까?$\n(로그인 정보와 자동화 설정이 모두 초기화됩니다.)" /SD IDNO IDNO skip_appdata_cleanup
    DetailPrint "Cleaning up AppData..."

    ; [New] Run UAC cleanup script if exists (Only when user agrees to full wipe)
    ; This ensures UAC settings are kept during reinstall/update (where user usually says NO to data wipe)
    IfFileExists "$APPDATA\${PRODUCT_FILENAME}\daumgamestarter_uac\uninstall_uac.bat" 0 skip_uac_cleanup
      DetailPrint "Removing UAC Bypass settings..."
      ExecWait '"$APPDATA\${PRODUCT_FILENAME}\daumgamestarter_uac\uninstall_uac.bat"'
    skip_uac_cleanup:

    ; Attempt to remove actual data path
    RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
  skip_appdata_cleanup:
!macroend
