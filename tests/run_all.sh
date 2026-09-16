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
echo "=== mode + history ==="     && python3 tests/test_mode_history.py
echo "=== multi-device sync ===" && python3 tests/test_sync.py
echo "=== doctor ==="            && python3 scripts/doctor.py > /dev/null && echo "doctor ran clean"
echo && echo "ALL TESTS PASSED"
