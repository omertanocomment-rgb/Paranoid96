import express from "express";
import cors from "cors";
import morgan from "morgan";
import chatRouter from "./src/routes/chat.js";
import { auth } from "./src/middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 8080;
const START = Date.now();

const origins = (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim());
app.use(cors({ origin: origins.includes("*") ? true : origins }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

// Public health endpoint (also reports configured model).
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    model: process.env.OMERTA_MODEL || "claude-opus-5",
    uptime: (Date.now() - START) / 1000,
    key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.get("/", (_req, res) => res.type("text/plain").send("Omerta AI backend — see /health and /api/config"));

// Everything under /api is gated by the optional shared secret.
app.use("/api", auth, chatRouter);

app.use((_req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT, () => {
  console.log(`[omerta] backend listening on :${PORT} (model=${process.env.OMERTA_MODEL || "claude-opus-5"}, key=${Boolean(process.env.ANTHROPIC_API_KEY)})`);
});
