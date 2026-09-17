#!/usr/bin/env bash
# Run every safety + integration test. Do this after touching core/.
set -e
cd "$(dirname "$0")/.."
echo "=== approval gate ==="     && python3 tests/test_approval.py
echo "=== tool parsing ==="     && python3 tests/test_toolparse.py
echo "=== integration ==="       && python3 tests/test_integration.py
echo "=== flash gating ==="      && python3 tests/test_flash.py
echo "=== auth / spoofing ==="   && python3 tests/test_auth.py
echo "=== embedded httpd ==="     && python3 tests/test_httpd.py
echo "=== firmware bring-up ===" && python3 tests/test_firmware.py
echo "=== code index ==="        && python3 tests/test_index.py
echo "=== sandbox isolate ===" && python3 tests/test_isolate.py
echo "=== roles ==="            && python3 tests/test_roles.py
echo "=== orchestrator ==="     && python3 tests/test_orchestrator.py
echo "=== git intelligence ==="  && python3 tests/test_gitx.py
echo "=== evidence ==="          && python3 tests/test_evidence.py
echo "=== approval policy ===" && python3 tests/test_policy.py
echo "=== terminal ==="          && python3 tests/test_terminal.py
echo "=== workspace / sandbox / theme ===" && python3 tests/test_workspace.py
echo "=== mode + history ==="     && python3 tests/test_mode_history.py
echo "=== multi-device sync ===" && python3 tests/test_sync.py
echo "=== doctor ==="            && python3 scripts/doctor.py > /dev/null && echo "doctor ran clean"
echo && echo "ALL TESTS PASSED"
