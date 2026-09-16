---
name: release-packaging
description: Packaging and shipping a build - versioning, changelogs, reproducible archives, and desktop packaging for Windows/macOS/Linux. Load when preparing a release or distributable.
---

# Release packaging

## Version + changelog first
Semver: breaking -> major, feature -> minor, fix -> patch. Tag the commit
the artifact was actually built from, not "latest main".

```bash
git tag -a v1.2.0 -m "release 1.2.0"
git log --oneline $(git describe --tags --abbrev=0 HEAD^)..HEAD
```

## Reproducible archives
```bash
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf release-v1.2.0.tar.gz dist/
sha256sum release-v1.2.0.tar.gz > release-v1.2.0.tar.gz.sha256
```

## Desktop (Electron)
```bash
npx electron-builder --win --mac --linux
```
Cross-building: Windows NSIS from Linux works via wine; AppImage/deb are
native. macOS signing/notarization requires a Mac host - there's no way
around that one.

## Ship checklist
1. Built from a clean checkout (`git status` empty)?
2. Version bumped in EVERY manifest (package.json, build.gradle, Info.plist)?
3. Checksums published next to artifacts?
4. Installed *from the artifact* on a clean machine, not just run from source?
