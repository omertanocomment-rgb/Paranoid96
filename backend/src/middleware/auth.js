// Optional shared-secret gate. When OMERTA_APP_TOKEN is set, requests must carry
// a matching x-omerta-key header (constant-time compared). Otherwise open.
import crypto from "crypto";

export function auth(req, res, next) {
  const expected = process.env.OMERTA_APP_TOKEN;
  if (!expected) return next();
  const provided = req.get("x-omerta-key") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  return res.status(401).json({ error: "unauthorized" });
}
