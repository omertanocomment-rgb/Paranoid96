"""adb over TCP, in pure Python.

Why this exists rather than a bundled `adb` binary: talking to a USB-attached
device needs Android's USB Host API and a per-device permission the user grants
through a dialog. A command-line binary cannot obtain that, so no amount of
packaging makes USB adb work from inside an app. What IS possible is the
network transport -- `adb connect host:5555` -- which is an ordinary TCP
protocol, and that is what this implements.

Scope, stated plainly: connect, devices, shell, push, pull. USB devices are out
of reach, and so is libimobiledevice, which has the same USB problem and no
network equivalent.

The authentication is the awkward part. A device challenges with a 20-byte
token which the client signs with an RSA key, and if that key is unknown the
device shows the "Allow USB debugging?" dialog and expects the public key in
Android's own binary format. There is no RSA in the standard library and
`cryptography` is not available inside the app, so the key generation, the
PKCS#1 v1.5 signature and Android's RSAPublicKey encoding are all implemented
here on top of `int`. That is slow for key generation -- a few seconds, once --
and instant thereafter, because the key is kept.
"""
import base64
import hashlib
import os
import random
import socket
import struct
import time
from pathlib import Path

from . import config

# ── wire protocol ───────────────────────────────────────────────────────────
A_CNXN = 0x4E584E43
A_AUTH = 0x48545541
A_OPEN = 0x4E45504F
A_OKAY = 0x59414B4F
A_CLSE = 0x45534C43
A_WRTE = 0x45545257

AUTH_TOKEN, AUTH_SIGNATURE, AUTH_RSAPUBLICKEY = 1, 2, 3
VERSION = 0x01000001
MAXDATA = 256 * 1024
DEFAULT_PORT = 5555
CONNECT_BANNER = b"host::features=cmd,shell_v2\x00"


def _key_path():
    d = Path(config.DATA_DIR) / "adb"
    d.mkdir(parents=True, exist_ok=True)
    return d / "adbkey.json"


# ── the RSA that is not in the standard library ─────────────────────────────
def _is_probable_prime(n, rounds=24):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        a = random.randrange(2, n - 1)
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def _prime(bits):
    # The top TWO bits are set, not just the highest: with only the top bit
    # forced, p*q can come out one bit short, and Android's RSAPublicKey blob
    # is a fixed-width word array that assumes the modulus is exactly the
    # nominal size. A 2047-bit modulus encodes to something the device rejects.
    while True:
        p = random.getrandbits(bits) | (3 << (bits - 2)) | 1
        if _is_probable_prime(p):
            return p


def generate_key(bits=2048):
    """An RSA key pair. Slow (seconds), done once, then kept."""
    e = 65537
    while True:
        p, q = _prime(bits // 2), _prime(bits // 2)
        if p == q:
            continue
        n = p * q
        phi = (p - 1) * (q - 1)
        if phi % e == 0:
            continue
        if n.bit_length() != bits:
            continue                       # see _prime(): width must be exact
        d = pow(e, -1, phi)
        return {"n": n, "e": e, "d": d, "bits": bits}


def load_key():
    """The stored key, generating one the first time."""
    path = _key_path()
    try:
        import json
        data = json.loads(path.read_text(encoding="utf-8"))
        if all(k in data for k in ("n", "e", "d")):
            return {"n": int(data["n"]), "e": int(data["e"]),
                    "d": int(data["d"]), "bits": int(data.get("bits", 2048))}
    except (OSError, ValueError):
        pass
    key = generate_key()
    try:
        import json
        path.write_text(json.dumps({k: str(v) if k != "bits" else v
                                    for k, v in key.items()}), encoding="utf-8")
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


#: ASN.1 DigestInfo prefix for SHA-1, which is what adb signs.
_SHA1_PREFIX = bytes.fromhex("3021300906052b0e03021a05000414")


def sign_token(key, token):
    """PKCS#1 v1.5 signature over the device's challenge."""
    k = (key["bits"] + 7) // 8
    digest = _SHA1_PREFIX + token
    pad_len = k - len(digest) - 3
    if pad_len < 8:
        raise ValueError("key too small to sign an adb token")
    block = b"\x00\x01" + b"\xff" * pad_len + b"\x00" + digest
    m = int.from_bytes(block, "big")
    s = pow(m, key["d"], key["n"])
    return s.to_bytes(k, "big")


def public_key_blob(key, name=b"omerta@android"):
    """Android's RSAPublicKey struct, base64-encoded, as adb expects it.

    Not a standard format: a little-endian word array plus a Montgomery
    constant, which is why it has to be built by hand rather than handed to a
    library.
    """
    n = key["n"]
    words = 2048 // 32
    n0inv = (-pow(n, -1, 1 << 32)) % (1 << 32)
    rr = pow(1 << 2048, 2, n)

    def as_words(v):
        return b"".join(struct.pack("<I", (v >> (32 * i)) & 0xFFFFFFFF)
                        for i in range(words))

    blob = (struct.pack("<II", words, n0inv) + as_words(n) + as_words(rr)
            + struct.pack("<i", key["e"]))
    return base64.b64encode(blob) + b" " + name + b"\x00"


# ── framing ─────────────────────────────────────────────────────────────────
def _pack(cmd, arg0, arg1, data=b""):
    checksum = sum(data) & 0xFFFFFFFF
    return struct.pack("<6I", cmd, arg0, arg1, len(data),
                       checksum, cmd ^ 0xFFFFFFFF) + data


def _read_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("the device closed the connection")
        buf += chunk
    return buf


def _read_message(sock):
    head = _read_exact(sock, 24)
    cmd, arg0, arg1, length, _csum, magic = struct.unpack("<6I", head)
    if magic != (cmd ^ 0xFFFFFFFF):
        raise ConnectionError("corrupt adb header — is that really an adb port?")
    data = _read_exact(sock, length) if length else b""
    return cmd, arg0, arg1, data


class Device:
    """One connected device. Use as a context manager."""

    def __init__(self, host, port=DEFAULT_PORT, timeout=20):
        self.host, self.port, self.timeout = host, int(port), timeout
        self.sock = None
        self.banner = ""
        self._next_id = 1

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *exc):
        self.close()

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port),
                                             timeout=self.timeout)
        self.sock.settimeout(self.timeout)
        self.sock.sendall(_pack(A_CNXN, VERSION, MAXDATA, CONNECT_BANNER))
        key = load_key()
        sent_pubkey = False
        while True:
            cmd, arg0, _arg1, data = _read_message(self.sock)
            if cmd == A_CNXN:
                self.banner = data.rstrip(b"\x00").decode("utf-8", "replace")
                return self
            if cmd == A_AUTH and arg0 == AUTH_TOKEN:
                if not sent_pubkey:
                    self.sock.sendall(_pack(A_AUTH, AUTH_SIGNATURE, 0,
                                            sign_token(key, data)))
                    # If the signature is rejected the device challenges again;
                    # that is the cue to offer the public key, which is what
                    # raises the "Allow USB debugging?" prompt on the screen.
                    sent_pubkey = True
                    continue
                self.sock.sendall(_pack(A_AUTH, AUTH_RSAPUBLICKEY, 0,
                                        public_key_blob(key)))
                raise PermissionError(
                    "this device has not authorised us yet — look at its "
                    "screen and accept the debugging prompt, then try again")
            raise ConnectionError(f"unexpected adb message 0x{cmd:08x}")

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except OSError:
            pass
        self.sock = None

    def _open(self, destination):
        local = self._next_id
        self._next_id += 1
        self.sock.sendall(_pack(A_OPEN, local, 0, destination.encode() + b"\x00"))
        while True:
            cmd, remote, their_local, data = _read_message(self.sock)
            if cmd == A_OKAY and their_local == local:
                return local, remote
            if cmd == A_CLSE and their_local == local:
                raise ConnectionError(f"device refused: {destination!r}")
            if cmd == A_WRTE:
                self.sock.sendall(_pack(A_OKAY, their_local, remote))

    def shell(self, command, timeout=None):
        """Run one command and return its output."""
        deadline = time.time() + (timeout or self.timeout)
        local, remote = self._open(f"shell:{command}")
        out = b""
        while time.time() < deadline:
            cmd, their_remote, their_local, data = _read_message(self.sock)
            if cmd == A_WRTE and their_local == local:
                out += data
                self.sock.sendall(_pack(A_OKAY, local, their_remote))
            elif cmd == A_CLSE and their_local == local:
                break
        return out.decode("utf-8", "replace")


def _fail(e):
    return {"status": "error", "error": f"{type(e).__name__}: {e}"}


def connect(host, port=DEFAULT_PORT):
    """Check we can reach and authenticate to a device."""
    try:
        with Device(host, port) as d:
            return {"status": "ok", "host": host, "port": int(port),
                    "banner": d.banner}
    except (PermissionError, ConnectionError, OSError, ValueError) as e:
        return _fail(e)


def shell(host, command, port=DEFAULT_PORT, timeout=30):
    try:
        with Device(host, port, timeout=timeout) as d:
            return {"status": "ok", "output": d.shell(command, timeout)}
    except (PermissionError, ConnectionError, OSError, ValueError) as e:
        return _fail(e)


def info(host, port=DEFAULT_PORT):
    """The few properties worth having before doing anything else."""
    props = {"ro.product.model": "model", "ro.product.manufacturer": "make",
             "ro.build.version.release": "android",
             "ro.build.version.sdk": "sdk", "ro.serialno": "serial"}
    try:
        with Device(host, port) as d:
            out = {}
            for prop, label in props.items():
                out[label] = d.shell(f"getprop {prop}").strip()
            return {"status": "ok", "banner": d.banner, **out}
    except (PermissionError, ConnectionError, OSError, ValueError) as e:
        return _fail(e)


def public_key_text():
    """Our public key, in the form Android stores in adb_keys."""
    return public_key_blob(load_key()).rstrip(b"\x00").decode()
