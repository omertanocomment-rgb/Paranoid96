"""Phase 3 — Local web UI + API (stdlib http.server, no dependencies).

Exposes the same wire protocol as the Omerta AI mobile backend so the Android/iOS
consoles can point directly at the engine in REMOTE mode:
  GET  /health              -> {status, model, uptime}
  GET  /api/config          -> {version, default_model, models[], thinking_enabled}
  POST /api/chat            -> {content, model, stop_reason, usage}
  POST /api/chat/stream     -> SSE: delta / done / error
  POST /api/agent           -> {results:[{role,text,model}]}
  GET  /                     -> minimal operator console (HTML)
Optional shared secret via $OMERTA_APP_TOKEN (x-omerta-key header).
"""
from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .. import __version__
from ..config import Config
from ..models.base import Message
from ..models.router import Router, CATEGORIES
from ..agents.orchestrator import Orchestrator

START = time.time()
KNOWN_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5",
                "claude-opus-4-8", "claude-fable-5-1"]

INDEX_HTML = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>OMERTA AI</title>
<style>
:root{color-scheme:dark}
body{background:#0A0A0B;color:#ECECEC;font-family:'JetBrains Mono',ui-monospace,monospace;margin:0}
header{padding:14px 16px;border-bottom:1px solid #2A2A2E;color:#FFB300;font-weight:600}
#log{padding:16px;max-width:820px;margin:0 auto}
.msg{border:1px solid #2A2A2E;border-radius:10px;padding:10px 14px;margin:8px 0;white-space:pre-wrap}
.user{background:#1F2A1A}.omerta{background:#16161A}
form{display:flex;gap:8px;padding:12px 16px;max-width:820px;margin:0 auto}
input{flex:1;background:#141416;border:1px solid #2A2A2E;color:#ECECEC;padding:10px;border-radius:8px;font-family:inherit}
button{background:#FFB300;color:#0A0A0B;border:0;border-radius:8px;padding:10px 16px;font-weight:600}
</style></head><body>
<header>OMERTA AI — operator console</header>
<div id=log></div>
<form id=f><input id=i placeholder="message omerta…" autocomplete=off><button>send</button></form>
<script>
const log=document.getElementById('log'),f=document.getElementById('f'),i=document.getElementById('i');
const hist=[];
function add(role,txt){const d=document.createElement('div');d.className='msg '+(role==='user'?'user':'omerta');d.textContent=(role==='user'?'OPERATOR\\n':'OMERTA\\n')+txt;log.appendChild(d);window.scrollTo(0,document.body.scrollHeight);return d;}
f.onsubmit=async e=>{e.preventDefault();const t=i.value.trim();if(!t)return;i.value='';add('user',t);hist.push({role:'user',content:t});
const d=add('omerta','…');let acc='';
const r=await fetch('/api/chat/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:hist})});
const rd=r.body.getReader();const dec=new TextDecoder();let buf='';
while(true){const{value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});
let idx;while((idx=buf.indexOf('\\n\\n'))>=0){const ev=buf.slice(0,idx);buf=buf.slice(idx+2);
let etype='message',data='';for(const line of ev.split('\\n')){if(line.startsWith('event:'))etype=line.slice(6).trim();if(line.startsWith('data:'))data+=line.slice(5).trim();}
if(!data)continue;const o=JSON.parse(data);if(etype==='delta'){acc+=o.text;d.textContent='OMERTA\\n'+acc;}else if(etype==='error'){d.textContent='ERROR\\n'+o.message;}}}
hist.push({role:'assistant',content:acc});};
</script></body></html>"""


def _auth_ok(headers) -> bool:
    expected = os.environ.get("OMERTA_APP_TOKEN", "")
    if not expected:
        return True
    return headers.get("x-omerta-key", "") == expected


class Handler(BaseHTTPRequestHandler):
    config: Config
    router: Router

    def log_message(self, *a):  # quieter
        pass

    def _send(self, code: int, obj, ctype="application/json"):
        body = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"status": "ok", "model": self.config.default_model,
                                    "uptime": time.time() - START})
        if self.path == "/api/config":
            return self._send(200, {"version": __version__,
                                    "default_model": self.config.default_model,
                                    "models": KNOWN_MODELS, "thinking_enabled": True,
                                    "categories": list(CATEGORIES)})
        if self.path in ("/", "/index.html"):
            return self._send(200, INDEX_HTML.encode(), "text/html; charset=utf-8")
        return self._send(404, {"error": "not found"})

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_POST(self):
        if not _auth_ok(self.headers):
            return self._send(401, {"error": "unauthorized"})
        try:
            data = self._body()
        except Exception:  # noqa: BLE001
            return self._send(400, {"error": "bad json"})

        if self.path == "/api/chat":
            return self._chat(data, stream=False)
        if self.path == "/api/chat/stream":
            return self._chat(data, stream=True)
        if self.path == "/api/agent":
            return self._agent(data)
        return self._send(404, {"error": "not found"})

    def _messages(self, data) -> tuple[list[Message], str, str, str]:
        msgs = [Message(m.get("role", "user"), m.get("content", ""))
                for m in data.get("messages", []) if m.get("content")]
        return (msgs, data.get("model") or self.config.default_model,
                data.get("system", ""), data.get("effort") or self.config.effort)

    def _chat(self, data, stream: bool):
        msgs, model, system, effort = self._messages(data)
        if not msgs:
            return self._send(400, {"error": "messages[] required"})
        provider = self.router.provider()
        try:
            if not stream:
                c = provider.complete(msgs, model=model, system=system, effort=effort)
                return self._send(200, {"content": c.text, "model": c.model,
                                        "stop_reason": c.stop_reason,
                                        "usage": {"input_tokens": c.input_tokens,
                                                  "output_tokens": c.output_tokens}})
            # streaming SSE
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            def sse(event, obj):
                self.wfile.write(f"event: {event}\n".encode())
                self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
                self.wfile.flush()

            for chunk in provider.stream(msgs, model=model, system=system, effort=effort):
                if chunk:
                    sse("delta", {"text": chunk})
            sse("done", {"model": model, "stop_reason": "end_turn"})
        except Exception as e:  # noqa: BLE001
            if stream:
                try:
                    self.wfile.write(b"event: error\n")
                    self.wfile.write(f"data: {json.dumps({'message': str(e)})}\n\n".encode())
                except Exception:  # noqa: BLE001
                    pass
            else:
                self._send(502, {"error": str(e)})

    def _agent(self, data):
        task = data.get("task", "")
        if not task:
            return self._send(400, {"error": "task required"})
        orch = Orchestrator(self.router)
        try:
            results = orch.plan_and_build(task)
            return self._send(200, {"results": [
                {"role": r.role, "text": r.text, "model": r.model} for r in results]})
        except Exception as e:  # noqa: BLE001
            return self._send(502, {"error": str(e)})


def serve(host: str | None = None, port: int | None = None) -> None:
    cfg = Config.load()
    Handler.config = cfg
    Handler.router = Router(cfg)
    h = host or cfg.web_host
    p = port or cfg.web_port
    httpd = ThreadingHTTPServer((h, p), Handler)
    print(f"[omerta] web/API on http://{h}:{p}  (Ctrl-C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[omerta] stopped")
