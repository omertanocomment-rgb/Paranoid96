# Omerta AI — iOS console

SwiftUI app: the iOS counterpart of the Android console. Dual-mode (EMBEDDED calls
the Anthropic API directly; REMOTE talks to the OMERTA engine / Node backend over the
same SSE protocol).

## Build (requires macOS + Xcode)
```bash
brew install xcodegen
cd ios && xcodegen generate
open OmertaAI.xcodeproj      # run on a simulator/device
```

## IPA via CI
`.github/workflows/ios-build.yml` builds an **unsigned** IPA on a macOS runner
(`omerta-ai-ipa-unsigned` artifact). Unsigned IPAs install via sideloading tools
(AltStore / Sideloadly) or can be re-signed with your Apple Developer identity.
A fully signed, App-Store/TestFlight build requires an Apple Developer account and
signing secrets — add them and switch `CODE_SIGNING_ALLOWED=YES` with an export
options plist.

> Note: this iOS target is built and verified in CI on macOS; it is not compiled in
> the Linux build sandbox.
