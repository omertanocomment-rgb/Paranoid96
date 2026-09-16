import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = process.env.OMERTA_MODEL || "claude-opus-5";
const DEFAULT_EFFORT = process.env.OMERTA_EFFORT || "high";

// Models we advertise to the app (GET /api/config). Anthropic model IDs are
// complete as-is — never append date suffixes.
export const KNOWN_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-opus-4-8",
  "claude-fable-5-1",
];

let client = null;
export function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export function defaults() {
  return { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT };
}

/**
 * Normalize incoming messages to Anthropic's shape and pull out any leading
 * system turns. Returns { system, messages }.
 */
export function normalize(rawMessages, systemOverride) {
  const messages = [];
  const systemParts = [];
  for (const m of rawMessages || []) {
    if (!m || typeof m.content !== "string") continue;
    if (m.role === "system") {
      systemParts.push(m.content);
    } else if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }
  const system = [systemOverride, ...systemParts].filter(Boolean).join("\n\n") || undefined;
  return { system, messages };
}

// adaptive thinking on every current model except Haiku (which takes budget_tokens).
function thinkingFor(model) {
  if (model.startsWith("claude-haiku")) {
    return { type: "enabled", budget_tokens: 2048 };
  }
  return { type: "adaptive" };
}

function baseParams({ model, system, messages, effort, maxTokens }) {
  const params = {
    model,
    max_tokens: maxTokens,
    thinking: thinkingFor(model),
    output_config: { effort: effort || DEFAULT_EFFORT },
    messages,
  };
  if (system) params.system = system;
  return params;
}

/** Non-streaming completion. */
export async function complete({ model, system, messages, effort }) {
  const c = getClient();
  const useModel = model || DEFAULT_MODEL;
  const resp = await c.messages.create(
    baseParams({ model: useModel, system, messages, effort, maxTokens: 16000 })
  );
  const text = (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    content: text,
    model: resp.model || useModel,
    stop_reason: resp.stop_reason || null,
    usage: resp.usage
      ? {
          input_tokens: resp.usage.input_tokens ?? 0,
          output_tokens: resp.usage.output_tokens ?? 0,
          cache_read_input_tokens: resp.usage.cache_read_input_tokens ?? 0,
        }
      : null,
  };
}

/**
 * Streaming completion. Calls the provided callbacks as events arrive.
 * onDelta(text), onThinking(text), onDone({model, stop_reason, usage}), onError(err).
 */
export async function stream({ model, system, messages, effort }, cbs) {
  const c = getClient();
  const useModel = model || DEFAULT_MODEL;
  const params = baseParams({ model: useModel, system, messages, effort, maxTokens: 32000 });
  // Ask for a readable summary so a thinking pane could render it later.
  params.thinking = { ...params.thinking, display: "summarized" };

  const s = c.messages.stream(params);
  s.on("text", (delta) => cbs.onDelta?.(delta));
  s.on("thinking", (delta) => cbs.onThinking?.(delta));
  s.on("error", (err) => cbs.onError?.(err));

  const final = await s.finalMessage();
  cbs.onDone?.({
    model: final.model || useModel,
    stop_reason: final.stop_reason || null,
    usage: final.usage
      ? {
          input_tokens: final.usage.input_tokens ?? 0,
          output_tokens: final.usage.output_tokens ?? 0,
          cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
        }
      : null,
  });
}
