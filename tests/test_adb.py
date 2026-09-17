#!/usr/bin/env python3
"""adb over TCP.

There is no phone in the build container, so the device is simulated -- but
not stubbed. The fake speaks the real framing, issues a real challenge, and
verifies the signature with the public exponent exactly as Android does. If
the RSA, the PKCS#1 padding or the key encoding were wrong, the handshake
would fail here the same way it fails on a real device.
"""
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


class FakeDevice(threading.Thread):
    """Speaks enough of the protocol to prove the client is correct."""

    def __init__(self, authorised=True):
        super().__init__(daemon=True)
        self.authorised = authorised
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(1)
        self.port = self.srv.getsockname()[1]
        self.signature_valid = None
        self.got_pubkey = False
        self.commands = []

    def run(self):
        from core import adbclient as adb
        try:
            conn, _ = self.srv.accept()
        except OSError:
            return
        conn.settimeout(10)
        try:
            cmd, _a0, _a1, _data = adb._read_message(conn)
            if cmd != adb.A_CNXN:
                return
            token = bytes(range(20))
            conn.sendall(adb._pack(adb.A_AUTH, adb.AUTH_TOKEN, 0, token))

            cmd, arg0, _a1, sig = adb._read_message(conn)
            if cmd == adb.A_AUTH and arg0 == adb.AUTH_SIGNATURE:
                key = adb.load_key()
                # exactly what a device does: RSA-verify with the public
                # exponent and compare the recovered DigestInfo
                m = pow(int.from_bytes(sig, "big"), key["e"], key["n"])
                block = m.to_bytes((key["bits"] + 7) // 8, "big")
                self.signature_valid = (
                    block[:2] == b"\x00\x01"
                    and block.endswith(adb._SHA1_PREFIX + token))
            if not self.authorised:
                conn.sendall(adb._pack(adb.A_AUTH, adb.AUTH_TOKEN, 0, token))
                cmd, arg0, _a1, blob = adb._read_message(conn)
                self.got_pubkey = (cmd == adb.A_AUTH
                                   and arg0 == adb.AUTH_RSAPUBLICKEY)
                return
            conn.sendall(adb._pack(adb.A_CNXN, adb.VERSION, adb.MAXDATA,
                                   b"device::ro.product.model=FakePhone\x00"))
            while True:
                cmd, local, _r, data = adb._read_message(conn)
                if cmd == adb.A_OPEN:
                    dest = data.rstrip(b"\x00").decode()
                    self.commands.append(dest)
                    remote = 77
                    conn.sendall(adb._pack(adb.A_OKAY, remote, local))
                    reply = b"fake-output\n"
                    if dest.startswith("shell:getprop "):
                        reply = dest.split("getprop ", 1)[1].encode() + b"-value\n"
                    conn.sendall(adb._pack(adb.A_WRTE, remote, local, reply))
                    adb._read_message(conn)                 # our OKAY
                    conn.sendall(adb._pack(adb.A_CLSE, remote, local))
                elif cmd == adb.A_CLSE:
                    break
        except Exception:  # noqa: BLE001 — the fake dying is a test failure, not a crash
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass


def main():
    print("=== adb over TCP ===")
    tmp = tempfile.mkdtemp(prefix="omerta-adb-")
    os.environ["OMERTA_DATA_DIR"] = tmp
    for m in [m for m in list(sys.modules) if m.startswith("core")]:
        del sys.modules[m]
    try:
        from core import adbclient as adb

        # ── the key ──────────────────────────────────────────────────────
        t0 = time.time()
        key = adb.load_key()
        first = time.time() - t0
        check("a key is generated on first use", key["n"].bit_length() == 2048)
        t0 = time.time()
        again = adb.load_key()
        check("the key is kept, not regenerated",
              again["n"] == key["n"] and (time.time() - t0) < first)
        check("the key file is not world-readable",
              (os.stat(Path(tmp) / "adb" / "adbkey.json").st_mode & 0o077) == 0)

        # ── the public key blob, in Android's format ─────────────────────
        blob = adb.public_key_blob(key)
        import base64
        raw = base64.b64decode(blob.split(b" ")[0])
        words, n0inv = struct.unpack("<II", raw[:8])
        check("the blob declares 64 modulus words", words == 64)
        check("the blob is the exact expected length", len(raw) == 8 + 256 + 256 + 4)
        n_back = int.from_bytes(raw[8:8 + 256], "little")
        check("the modulus round-trips through the blob", n_back == key["n"])
        rr_back = int.from_bytes(raw[8 + 256:8 + 512], "little")
        check("the Montgomery constant is right",
              rr_back == pow(1 << 2048, 2, key["n"]))
        check("n0inv is right",
              (n0inv * key["n"]) % (1 << 32) == (-1) % (1 << 32))
        check("the exponent is 65537",
              struct.unpack("<i", raw[-4:])[0] == 65537)
        check("the blob is newline-free and NUL-terminated",
              b"\n" not in blob and blob.endswith(b"\x00"))

        # ── the handshake, against a device that really verifies ─────────
        dev = FakeDevice(authorised=True)
        dev.start()
        res = adb.connect("127.0.0.1", dev.port)
        time.sleep(0.2)
        check("the connection succeeds", res.get("status") == "ok")
        check("the device accepted our signature", dev.signature_valid is True)
        check("the device banner is reported",
              "FakePhone" in res.get("banner", ""))

        # ── shell ────────────────────────────────────────────────────────
        dev2 = FakeDevice(authorised=True)
        dev2.start()
        r = adb.shell("127.0.0.1", "id", port=dev2.port)
        check("shell returns output", r.get("output", "").strip() == "fake-output")
        check("shell sends the command as a shell: stream",
              dev2.commands and dev2.commands[0] == "shell:id")

        # ── an unauthorised device ───────────────────────────────────────
        dev3 = FakeDevice(authorised=False)
        dev3.start()
        r = adb.connect("127.0.0.1", dev3.port)
        time.sleep(0.3)
        check("an unauthorised device is reported, not crashed into",
              r.get("status") == "error")
        check("the message says to accept the prompt",
              "prompt" in r.get("error", "").lower())
        check("the public key is offered so the prompt appears",
              dev3.got_pubkey is True)

        # ── failure modes ────────────────────────────────────────────────
        r = adb.connect("127.0.0.1", 1)
        check("an unreachable port is an error, not an exception",
              r.get("status") == "error")
        junk = socket.socket()
        junk.bind(("127.0.0.1", 0))
        junk.listen(1)

        def babble():
            try:
                c, _ = junk.accept()
                c.sendall(b"this is not adb at all, not even close" * 4)
                c.close()
            except OSError:
                pass
        threading.Thread(target=babble, daemon=True).start()
        r = adb.connect("127.0.0.1", junk.getsockname()[1])
        check("a non-adb service is detected rather than hanging",
              r.get("status") == "error")
        junk.close()
    finally:
        os.environ.pop("OMERTA_DATA_DIR", None)
        shutil.rmtree(tmp, ignore_errors=True)
        for m in [m for m in list(sys.modules) if m.startswith("core")]:
            del sys.modules[m]

    print()
    if fails:
        print(f"ADB TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("ADB TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
