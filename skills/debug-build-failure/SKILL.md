---
name: debug-build-failure
description: Systematic approach when a build, compile, test or run fails
triggers: [error, failed, failure, traceback, exception, wont compile, broken, crash, stacktrace, regression]
---

# Debugging a failure

## Order of operations

1. **Read the FIRST error, not the last.** Build tools cascade; the final
   message is usually a downstream symptom.
2. Get more signal: `./gradlew ... --stacktrace --info`, `make V=1`,
   `npm run build --verbose`, `python -X dev`.
3. Check the boring causes before the interesting ones:
   - stale build dir (`./gradlew clean`, `rm -rf node_modules build`)
   - wrong tool version (`java -version`, `node -v`, `python -V`)
   - missing env var (`ANDROID_HOME`, `ANDROID_NDK_HOME`, `PATH`)
   - disk full (`df -h`) — produces bizarre, misleading errors
4. Isolate: does a minimal case build? Bisect with `git stash` / `git bisect`.
5. Only then search the exact error string.

## When the first fix doesn't work

Stop and re-read the actual error output rather than trying a second guess.
Two failed guesses in a row means the mental model is wrong, not the fix.
State the current hypothesis explicitly before trying again.

## Record the fix

Once solved, call the `remember` tool with kind `error_fix`, storing both the
error signature and the resolution, so it isn't re-debugged next month.
