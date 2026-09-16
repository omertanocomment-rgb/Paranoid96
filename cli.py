#!/usr/bin/env python3
"""OMERTA AGENT — terminal client. Works fully offline."""
import argparse
import json
import sys

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table

from core.agent import Agent
from core import config, memory, router, sandbox, skills, plugins, mcp, auth, sync

c = Console()

BANNER = r"""[bold #ffb020]
   ____  __  __ _____ ____ _____  _
  / __ \|  \/  | ____|  _ \_   _|/ \
 | |  | | |\/| |  _| | |_) || | / _ \
 | |__| | |  | | |___|  _ < | |/ ___ \
  \____/|_|  |_|_____|_| \_\|_/_/   \_\  AGENT
[/bold #ffb020][dim]  every action asks first · offline-capable · learns your calls[/dim]"""


def show_status():
    t = Table(box=None, pad_edge=False)
    t.add_column("brain", style="bold"); t.add_column("model"); t.add_column("state")
    for pid, s in router.provider_status().items():
        state = "[green]ready[/green]" if s["ready"] else f"[dim]{s['why']}[/dim]"
        t.add_row(pid, s["model"], state)
    c.print(t)
    ms = memory.stats()
    c.print(f"[dim]memory: {ms['facts']} facts · {ms['choices']} recorded choices · "
            f"projects: {', '.join(ms['projects']) or 'none'}[/dim]")
    c.print(f"[dim]always-ask: {'ON' if config.ALWAYS_ASK else 'OFF'} · "
            f"skills: {len(skills.load_all())} · plugins: {len(plugins.loaded())} · "
            f"connectors: {sum(1 for x in mcp.status() if x['connected'])} connected[/dim]")


def render_pending(p):
    danger = p.get("danger")
    style = "red" if danger else "#ffb020"
    head = "⚠ DESTRUCTIVE — READ CAREFULLY" if danger else "approval needed"
    body = f"[bold]{p['action']}[/bold]"
    hist = p.get("history") or {}
    if hist.get("hint") == "likely_deny":
        body += f"\n[red]note: {hist['detail']}[/red]"
    elif hist.get("hint") == "routinely_approved":
        body += f"\n[dim]note: {hist['detail']}[/dim]"
    c.print(Panel(body, title=head, border_style=style))
    c.print("[dim]y = run · n = refuse · e = edit · or type a reason for refusing[/dim]")


def handle(agent, result):
    """Print a result and drive the approval loop until nothing is pending."""
    while True:
        prov = result.get("provider") or "?"
        tag = "[magenta]offline[/magenta]" if result.get("offline") else "[cyan]online[/cyan]"
        if result.get("text"):
            c.print(f"[dim]{prov} {tag}[/dim]")
            c.print(Markdown(result["text"]))
        p = result.get("pending")
        if not p:
            return
        render_pending(p)
        ans = c.input("[bold #ffb020]approve?[/bold #ffb020] ").strip()
        low = ans.lower()
        if low in ("y", "yes"):
            result = agent.approve()
        elif low in ("e", "edit"):
            newc = c.input("rewrite command: ").strip()
            result = agent.edit_and_approve(newc) if newc else agent.deny("user cancelled")
        elif low in ("n", "no", ""):
            result = agent.deny()
        else:
            result = agent.deny(note=ans)


def main():
    ap = argparse.ArgumentParser(description="OMERTA AGENT")
    ap.add_argument("--project", default="general")
    ap.add_argument("--provider", default=None, help="pin a brain (see /status)")
    ap.add_argument("-c", "--command", default=None, help="one-shot prompt then exit")
    args = ap.parse_args()

    if args.provider:
        config.set_setting("OMERTA_PROVIDER", args.provider)

    memory.init()
    plugins.load_all()
    conn = mcp.connect_all()
    agent = Agent(project=args.project)

    if args.command:
        handle(agent, agent.turn(args.command))
        return 0

    c.print(BANNER)
    c.print(f"[dim]project: {args.project} · /help for commands[/dim]\n")
    for r in conn:
        if r["status"] == "connected":
            c.print(f"[green]connector[/green] {r['name']} ({r['tools']} tools)")
        elif r["status"] == "failed":
            c.print(f"[red]connector[/red] {r['name']}: {r['error'][:80]}")

    while True:
        try:
            line = c.input("\n[bold green]you>[/bold green] ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            continue
        low = line.lower()

        if low in ("exit", "quit", "/exit", "/quit"):
            break
        if low == "/help":
            c.print(Panel(
                "/status            brains, memory, skills, plugins, connectors\n"
                "/model <id|auto>   pin a brain (claude, ollama, openai, ...)\n"
                "/models            list every configured brain\n"
                "/skills            list skills   · /skill <name> to read one\n"
                "/plugins [reload]  list/reload plugins\n"
                "/connectors        MCP connector status\n"
                "/memory [query]    search long-term memory\n"
                "/prefs             what the agent has learned about your calls\n"
                "/history [n]       commands actually executed\n"
                "/backups           snapshots taken before file edits\n"
                "/import <path>     import Claude/ChatGPT export, notes dir, or repo\n"
                "/doctor            run the environment check\n"
                "/project <name>    switch project scope\n"
                "/reset             clear conversation (memory kept)\n"
                "/ask on|off        toggle always-ask (default ON — keep it on)\n"
                "/sync              sync memory (uses OMERTA_SYNC_DIR)\n"
                "/sync <host:port>  sync with another device over LAN\n"
                "/sync dir <path>   sync through a shared/synced folder\n"
                "/sync status       peers, folders, last sync times\n"
                "/token             show the server access token\n"
                "/token rotate      generate a new server token",
                title="commands", border_style="#ffb020"))
            continue
        if low == "/status":
            show_status(); continue
        if low.startswith("/model "):
            pid = line.split(maxsplit=1)[1].strip()
            if pid != "auto" and pid not in config.PROVIDERS:
                c.print(f"[red]unknown[/red]. options: auto, {', '.join(config.PROVIDERS)}")
                continue
            config.set_setting("OMERTA_PROVIDER", pid)
            c.print(f"[green]brain set to {pid}[/green]"); continue
        if low == "/models":
            show_status(); continue
        if low == "/skills":
            for s in skills.load_all():
                c.print(f"[bold]{s['name']}[/bold] — {s['description']}")
            continue
        if low.startswith("/skill "):
            c.print(Markdown(skills.load_body(line.split(maxsplit=1)[1].strip()))); continue
        if low.startswith("/plugins"):
            if "reload" in low:
                plugins.load_all(verbose=True); c.print("[green]reloaded[/green]")
            for n, d in plugins.loaded().items():
                err = " [red](failed)[/red]" if "error" in d else ""
                c.print(f"[bold]{n}[/bold]{err} — {d['manifest'].get('description','')} "
                        f"tools={d['tools']}")
            continue
        if low == "/connectors":
            for s in mcp.status():
                mark = "[green]●[/green]" if s["connected"] else "[dim]○[/dim]"
                c.print(f"{mark} {s['name']} ({s['transport']}) tools={len(s['tools'])}")
            continue
        if low.startswith("/memory"):
            q = line.partition(" ")[2].strip()
            for h in memory.recall(q, project=args.project, top_k=15):
                c.print(f"[dim]{h['kind']}[/dim] {h['content'][:160]}")
            continue
        if low == "/prefs":
            c.print(memory.preference_block(project=args.project) or "[dim]nothing learned yet[/dim]")
            continue
        if low.startswith("/history"):
            n = int(line.split()[1]) if len(line.split()) > 1 else 15
            for h in sandbox.history(n):
                rc = h.get("returncode")
                mark = "[green]✓[/green]" if rc == 0 else "[red]✗[/red]"
                c.print(f"{mark} {h.get('cmd','')[:110]}")
            continue
        if low == "/backups":
            from tools.fileops import list_backups
            for b in list_backups()["backups"]:
                c.print(f"[dim]{b}[/dim]")
            continue
        if low.startswith("/project "):
            args.project = line.split(maxsplit=1)[1].strip()
            agent = Agent(project=args.project)
            c.print(f"[green]project: {args.project}[/green]"); continue
        if low.startswith("/import "):
            from tools import importers
            path = line.split(maxsplit=1)[1].strip()
            with c.status("[dim]importing...[/dim]"):
                res = importers.auto(path, project=args.project)
            c.print(res)
            continue
        if low == "/doctor":
            import subprocess as _sp
            _sp.run([sys.executable, "scripts/doctor.py"])
            continue
        if low == "/reset":
            agent.reset(); c.print("[dim]conversation cleared, memory intact[/dim]"); continue
        if low.startswith("/sync"):
            parts = line.split()
            with c.status("[dim]syncing...[/dim]"):
                if len(parts) == 1:
                    if not config.SYNC_DIR:
                        c.print("[yellow]set OMERTA_SYNC_DIR, or use "
                                "/sync <host:port> or /sync dir <path>[/yellow]")
                        continue
                    res = sync.sync_file(config.SYNC_DIR)
                elif parts[1] == "status":
                    res = sync.status()
                elif parts[1] == "dir" and len(parts) > 2:
                    res = sync.sync_file(parts[2])
                else:
                    res = sync.sync_peer(parts[1],
                                         token=parts[2] if len(parts) > 2 else None)
            c.print(res)
            continue
        if low.startswith("/token"):
            if "rotate" in low:
                c.print(f"[green]new token:[/green] {auth.rotate()}")
            else:
                c.print(f"[dim]server token:[/dim] {auth.get_token()}")
                c.print("[dim]other devices append ?token=... ; loopback is exempt[/dim]")
            continue
        if low.startswith("/ask "):
            val = low.split()[1] == "on"
            config.set_setting("OMERTA_ALWAYS_ASK", val)
            c.print(f"[yellow]always-ask {'ON' if val else 'OFF'} — restart to apply[/yellow]")
            continue

        with c.status("[dim]working...[/dim]"):
            result = agent.turn(line)
        handle(agent, result)

    mcp.disconnect_all()
    c.print("\n[dim]session ended — memory saved[/dim]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
