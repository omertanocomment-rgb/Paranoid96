"""PyInstaller entrypoint — single-file executable, no Python install needed."""
import sys, os
if getattr(sys, "frozen", False):
    os.environ.setdefault("OMERTA_BUNDLED", "1")
    base = sys._MEIPASS
    sys.path.insert(0, base)
from core import config  # noqa: E402


def main():
    argv = sys.argv[1:]
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
    if cmd in ("version", "--version", "-V"):
        print("omerta-agent 1.0.0")
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
