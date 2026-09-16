import { Router } from "express";
import { complete, stream, normalize, defaults, KNOWN_MODELS } from "../lib/anthropic.js";

const router = Router();

router.get("/config", (_req, res) => {
  const d = defaults();
  res.json({
    version: "1.0.0",
    default_model: d.model,
    models: KNOWN_MODELS,
    thinking_enabled: true,
  });
});

// Non-streaming chat.
router.post("/chat", async (req, res) => {
  try {
    const { messages, model, system, effort } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] is required" });
    }
    const norm = normalize(messages, system);
    const result = await complete({ model, effort, ...norm });
    res.json(result);
  } catch (err) {
    console.error("chat error:", err?.message || err);
    res.status(502).json({ error: err?.message || "upstream error" });
  }
});

// Streaming chat over Server-Sent Events.
router.post("/chat/stream", async (req, res) => {
  const { messages, model, system, effort } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages[] is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.on("close", () => { closed = true; });

  // keepalive comments so proxies don't time the connection out
  const ka = setInterval(() => { if (!closed) res.write(": keepalive\n\n"); }, 15000);

  try {
    const norm = normalize(messages, system);
    await stream(
      { model, effort, ...norm },
      {
        onDelta: (t) => { if (!closed && t) send("delta", { text: t }); },
        onThinking: (t) => { if (!closed && t) send("thinking", { text: t }); },
        onDone: (d) => { if (!closed) send("done", d); },
        onError: (e) => { if (!closed) send("error", { message: e?.message || "stream error" }); },
      }
    );
  } catch (err) {
    console.error("stream error:", err?.message || err);
    if (!closed) send("error", { message: err?.message || "upstream error" });
  } finally {
    clearInterval(ka);
    if (!closed) res.end();
  }
});

export default router;
