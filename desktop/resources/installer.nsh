; Omerta NSIS installer customization
; Included via build.nsis.include in package.json

!macro customInstall
  ; Make sure the tools folder exists so first-run tool detection has
  ; somewhere to look, even before the user downloads anything.
  CreateDirectory "$INSTDIR\resources\bin"
!macroend

!macro customUnInstall
  ; Downloaded tools (ADB, ffmpeg, iOS tools, etc.) can be large and slow to
  ; re-fetch, so ask before deleting them instead of silently wiping them.
  IfFileExists "$INSTDIR\resources\bin\*.*" 0 skip_bin_prompt
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Also remove downloaded tools (ADB, ffmpeg, iOS tools) in the bin folder?$\n$\nChoose No to keep them for a future reinstall." \
      IDNO skip_bin_removal
    RMDir /r "$INSTDIR\resources\bin"
  skip_bin_removal:
  skip_bin_prompt:
!macroend
