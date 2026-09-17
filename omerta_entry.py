"""PyInstaller entrypoint — single-file executable, no Python install needed."""
import sys, os
if getattr(sys, "frozen", False):
    os.environ.setdefault("OMERTA_BUNDLED", "1")
    base = sys._MEIPASS
    sys.path.insert(0, base)
from core import config  # noqa: E402


VERSION_FLAGS = ("version", "--version", "-V")


def _version():
    """Single source of truth: the installed metadata, else pyproject."""
    try:
        from importlib.metadata import version
        return version("omerta-agent")
    except Exception:
        pass
    import re
    bases = [b for b in (getattr(sys, "_MEIPASS", None),
                         os.environ.get("OMERTA_HOME"),
                         os.path.dirname(os.path.abspath(__file__))) if b]
    # a VERSION file is what a /opt-style install (the .deb) ships, since it
    # has no pyproject.toml and is not pip-installed
    for base in bases:
        try:
            v = open(os.path.join(base, "VERSION")).read().strip()
        except OSError:
            continue
        if v:
            return v
    for base in bases:
        try:
            txt = open(os.path.join(base, "pyproject.toml")).read()
        except OSError:
            continue
        m = re.search(r'version\s*=\s*"([^"]+)"', txt)
        if m:
            return m.group(1)
    return "unknown"


def main():
    argv = sys.argv[1:]
    # a leading flag is not a subcommand — except the version flags, which
    # would otherwise fall through to argparse and die as "unrecognized".
    if argv and argv[0] in VERSION_FLAGS:
        print(f"omerta-agent {_version()}")
        return 0
    cmd = argv[0] if argv and not argv[0].startswith("-") else None
    if cmd == "serve":
        sys.argv = [sys.argv[0]] + argv[1:]
        try:
            import server
            return server.run() if hasattr(server, "run") else None
        except ImportError:
            # FastAPI/uvicorn not installed — fall back to the dependency-free
            # stdlib server. Same protocol, same approval gate.
            from core import httpd
            return httpd.run()
    if cmd == "doctor":
        sys.argv = [sys.argv[0]] + argv[1:]
        import runpy
        # run_path returns the module globals — discard it, or it gets
        # printed as the process result.
        runpy.run_path(os.path.join(getattr(sys, "_MEIPASS", "."),
                                    "scripts", "doctor.py"),
                       run_name="__main__")
        return 0
    if cmd == "sync":
        from core import sync
        t = argv[1] if len(argv) > 1 else None
        if t and ":" in t and "/" not in t:
            print(sync.sync_peer(t, token=argv[2] if len(argv) > 2 else None))
        elif t:
            print(sync.sync_file(t))
        elif config.SYNC_DIR:
            print(sync.sync_file(config.SYNC_DIR))
        else:
            print("set OMERTA_SYNC_DIR, or: omerta sync <host:port|/path>")
        return 0
    if cmd in VERSION_FLAGS:
        print(f"omerta-agent {_version()}")
        return 0
    # firmware / teach / memory / index / search / rules
    from core import commands
    if cmd in commands.HANDLED:
        rc = commands.dispatch(argv)
        if rc is not None:
            return rc
    sys.argv = [sys.argv[0]] + argv
    import cli
    return cli.main()


if __name__ == "__main__":
    sys.exit(main() or 0)
