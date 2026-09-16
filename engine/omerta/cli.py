"""Phase 3 — OMERTA AI command-line interface."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, constitution, doctor
from .config import Config
from .memory.db import Memory
from .models.base import Message
from .models.router import Router
from .codebase.index import Index
from .gitengine.engine import Git
from .sandbox.runner import Sandbox
from .buildloop.loop import BuildLoop
from .firmware import inspect as fw
from .firmware.inspect import inspect_image, toolchain
from .agents.orchestrator import Orchestrator, ROLES


def _p(*a):
    print(*a)


def cmd_doctor(_args):
    _p(doctor.render(doctor.run()))


def _chat_system() -> str:
    """Constitution + operator-taught memory, so chat applies what you teach."""
    parts = []
    con = constitution.load()
    if con:
        parts.append(con)
    mem = Memory()
    taught = mem.learned_context()
    mem.close()
    if taught:
        parts.append(taught)
    return "\n\n".join(parts)


def cmd_chat(args):
    router = Router()
    provider, model = router.resolve(args.model)
    ok, reason = provider.available()
    if not ok:
        _p(f"[UNKNOWN] provider '{provider.name}' unavailable: {reason}")
        return 2
    system = _chat_system()
    msgs = [Message("user", args.prompt)] if args.prompt else None
    if msgs is None:
        _p(f"omerta chat [{provider.name}:{model}] — type a message (Ctrl-D to exit)")
        history: list[Message] = []
        while True:
            try:
                line = input("you> ").strip()
            except EOFError:
                _p(); break
            if not line:
                continue
            history.append(Message("user", line))
            sys.stdout.write("omerta> ")
            acc = ""
            for chunk in provider.stream(history, model=model,
                                         system=system, effort=router.config.effort):
                sys.stdout.write(chunk); sys.stdout.flush(); acc += chunk
            _p()
            history.append(Message("assistant", acc))
        return 0
    for chunk in provider.stream(msgs, model=model, system=system, effort=router.config.effort):
        sys.stdout.write(chunk); sys.stdout.flush()
    _p()
    return 0


def cmd_learn(args):
    """Teach a durable rule by command — the model applies it in future turns."""
    mem = Memory()
    mid = mem.teach(args.key, args.value, scope=args.scope, type="RULE")
    mem.close()
    _p(f"[CONFIRMED] learned RULE #{mid} [{args.scope}] {args.key}: {args.value}")


def cmd_agent(args):
    orch = Orchestrator()
    if args.role:
        r = orch.run(args.role, args.task)
        _p(f"[{r.role} · {r.model}]\n{r.text}")
    else:
        for r in orch.plan_and_build(args.task):
            _p(f"\n===== {r.role.upper()} ({r.model}) =====\n{r.text}")
    return 0


def cmd_index(args):
    idx = Index(Path.cwd())
    nf, ns = idx.build(); idx.close()
    _p(f"[CONFIRMED] indexed {nf} files, {ns} symbols into .omerta/index.db")


def cmd_search(args):
    idx = Index(Path.cwd())
    for h in idx.search(args.term):
        _p(f"{h.path}:{h.line}: {h.text}")
    idx.close()


def cmd_symbol(args):
    idx = Index(Path.cwd())
    hits = idx.symbol(args.name)
    if not hits:
        _p(f"[UNKNOWN] no symbol '{args.name}' (run `omerta index` first)")
    for h in hits:
        _p(f"{h.path}:{h.line}: {h.text}")
    idx.close()


def cmd_inspect(_args):
    idx = Index(Path.cwd()); f, s = idx.stats(); idx.close()
    g = Git()
    _p(f"workspace: {Path.cwd()}")
    _p(f"index: {f} files, {s} symbols")
    if g.is_repo():
        _p(f"git: {g.current_branch()} @ {g.head()} ({'clean' if g.is_clean() else 'dirty'})")
    else:
        _p("git: not a repository")
    con = constitution.find()
    _p(f"constitution: {con if con else 'none (run `omerta constitution init`)'}")


def cmd_memory(args):
    mem = Memory()
    if args.action == "list":
        for it in mem.show(scope=args.scope, type=args.type):
            _p(it.render())
    elif args.action == "search":
        for it in mem.search(args.term):
            _p(it.render())
    elif args.action == "forget":
        _p("forgotten" if mem.forget(int(args.term)) else "no active item with that id")
    mem.close()


def cmd_teach(args):
    mem = Memory()
    mid = mem.teach(args.key, args.value, scope=args.scope, type=args.type)
    mem.close()
    _p(f"[CONFIRMED] taught #{mid} [{args.scope}/{args.type}] {args.key}")


def cmd_constitution(args):
    if args.action == "init":
        path = constitution.init(force=args.force)
        _p(f"[CONFIRMED] {path}")
    else:
        _p(constitution.load() or "no OMERTA.md found")


def cmd_sandbox(_args):
    for k, v in Sandbox().status().items():
        _p(f"{k:<16} {v}")


def cmd_git(_args):
    g = Git()
    if not g.is_repo():
        _p("[UNKNOWN] not a git repository"); return 1
    _p(g.status())


def _strip_dashes(cmd: list[str]) -> list[str]:
    return cmd[1:] if cmd and cmd[0] == "--" else cmd


def cmd_build(args):
    command = _strip_dashes(args.command)
    if not command:
        _p("usage: omerta build -- <command>"); return 2
    mem = Memory()
    ev = BuildLoop(memory=mem).run(command, artifacts=args.artifact or [])
    mem.close()
    _p(ev.evidence().render())
    if ev.stderr_tail and not ev.ok:
        _p("--- stderr (tail) ---"); _p(ev.stderr_tail)
    return 0 if ev.ok else 1


def cmd_test(args):
    return cmd_build(argparse.Namespace(command=args.command or ["pytest", "-q"], artifact=[]))


def cmd_debug(args):
    orch = Orchestrator()
    r = orch.run("debugger", f"Root-cause this error with evidence:\n\n{args.error}", "debugging")
    _p(f"[{r.role} · {r.model}]\n{r.text}")


def cmd_review(_args):
    g = Git(); diff = g.diff() if g.is_repo() else ""
    if not diff:
        _p("[UNKNOWN] no working-tree diff to review"); return 1
    orch = Orchestrator()
    r = orch.run("reviewer", f"Review this diff:\n\n{diff[:20000]}", "review")
    _p(f"[{r.role} · {r.model}]\n{r.text}")


def _dump(d: dict):
    for k, v in d.items():
        _p(f"{k}: {v}")


def cmd_firmware(args):
    op = args.what
    if op == "tools":
        for t, ok in toolchain().items():
            _p(f"[{'OK ' if ok else 'XX '}] {t}")
        return
    if op == "inspect":
        _dump(inspect_image(args.image)); return
    if op == "run":
        _dump(fw.run_tool(args.image, args.args)); return
    if op == "unpack":
        _dump(fw.unpack_boot(args.image)); return
    if op == "avb":
        _dump(fw.avb_info(args.image)); return
    if op == "dts":
        _dump(fw.dtb_to_dts(args.image)); return
    if op == "dtb":
        _dump(fw.dts_to_dtb(args.image)); return
    if op == "sparse":
        _dump(fw.sparse_to_raw(args.image)); return
    if op == "superunpack":
        _dump(fw.super_unpack(args.image)); return
    if op == "extract":
        _dump(fw.extract(args.image)); return


def cmd_web(args):
    from .web.server import serve
    serve(args.host, args.port)


def cmd_config(_args):
    from .config import home_dir, scaffold_project
    cfg = Config.load(); path = cfg.save()
    proj = scaffold_project()
    _p(f"[CONFIRMED] config at {path}")
    d = home_dir()
    for f in ("config.toml", "providers.toml", "policies.toml"):
        _p(f"  {'OK ' if (d / f).exists() else 'XX '} {d / f}")
    _p(f"[CONFIRMED] project scaffold at {proj} ({', '.join(p.name for p in sorted(proj.iterdir()))})")
    for k, v in cfg.__dict__.items():
        _p(f"  {k} = {v}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="omerta",
                                description="OMERTA AI — evidence-backed engineering agent")
    p.add_argument("--version", action="version", version=f"omerta {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="detect dependencies").set_defaults(fn=cmd_doctor)

    c = sub.add_parser("chat", help="chat with the model"); c.add_argument("prompt", nargs="?")
    c.add_argument("--model", help="provider:model, e.g. openai:gpt-4o, ollama:llama3.1")
    c.set_defaults(fn=cmd_chat)

    ln = sub.add_parser("learn", help="teach a durable rule the model will apply")
    ln.add_argument("key"); ln.add_argument("value")
    ln.add_argument("--scope", default="global"); ln.set_defaults(fn=cmd_learn)

    a = sub.add_parser("agent", help="run a task through agents")
    a.add_argument("task"); a.add_argument("--role", choices=sorted(ROLES))
    a.set_defaults(fn=cmd_agent)

    sub.add_parser("index", help="index the repo").set_defaults(fn=cmd_index)
    s = sub.add_parser("search", help="search the repo"); s.add_argument("term")
    s.set_defaults(fn=cmd_search)
    sy = sub.add_parser("symbol", help="find a symbol"); sy.add_argument("name")
    sy.set_defaults(fn=cmd_symbol)
    sub.add_parser("inspect", help="workspace overview").set_defaults(fn=cmd_inspect)

    m = sub.add_parser("memory", help="memory ops")
    m.add_argument("action", choices=["list", "search", "forget"])
    m.add_argument("term", nargs="?"); m.add_argument("--scope"); m.add_argument("--type")
    m.set_defaults(fn=cmd_memory)

    t = sub.add_parser("teach", help="teach a rule/fact")
    t.add_argument("key"); t.add_argument("value")
    t.add_argument("--scope", default="project"); t.add_argument("--type", default="LESSON")
    t.set_defaults(fn=cmd_teach)

    con = sub.add_parser("constitution", help="project constitution")
    con.add_argument("action", choices=["init", "show"], nargs="?", default="show")
    con.add_argument("--force", action="store_true"); con.set_defaults(fn=cmd_constitution)

    sub.add_parser("sandbox", help="sandbox status").set_defaults(fn=cmd_sandbox)
    sub.add_parser("git", help="git status").set_defaults(fn=cmd_git)

    b = sub.add_parser("build", help="run a build command with evidence")
    b.add_argument("command", nargs=argparse.REMAINDER)
    b.add_argument("--artifact", action="append"); b.set_defaults(fn=cmd_build)
    te = sub.add_parser("test", help="run tests with evidence")
    te.add_argument("command", nargs=argparse.REMAINDER); te.set_defaults(fn=cmd_test)

    d = sub.add_parser("debug", help="root-cause an error"); d.add_argument("error")
    d.set_defaults(fn=cmd_debug)
    sub.add_parser("review", help="review the working-tree diff").set_defaults(fn=cmd_review)

    fwp = sub.add_parser("firmware", help="inspect firmware, run toolchain, unpack images")
    fwp.add_argument("what", choices=["tools", "inspect", "run", "unpack", "avb",
                                      "dts", "dtb", "sparse", "superunpack", "extract"])
    fwp.add_argument("image", nargs="?")
    fwp.add_argument("args", nargs=argparse.REMAINDER, help="extra args for `run <tool>`")
    fwp.set_defaults(fn=cmd_firmware)

    w = sub.add_parser("web", help="serve the web UI + API")
    w.add_argument("--host"); w.add_argument("--port", type=int); w.set_defaults(fn=cmd_web)

    sub.add_parser("config", help="write/show config").set_defaults(fn=cmd_config)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "firmware" and args.what != "tools" and not args.image:
        _p(f"usage: omerta firmware {args.what} <image-or-tool>"); return 2
    rc = args.fn(args)
    return int(rc) if isinstance(rc, int) else 0


if __name__ == "__main__":
    raise SystemExit(main())
