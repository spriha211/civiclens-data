// /api/perplexity.js
export default async function handler(req, res) {
  // --- CORS (Flutter web) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Origin, Cache-Control, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Parse body robustly
  async function readBody() {
    if (req.body && typeof req.body === "object") return req.body;
    const raw = await new Promise((resolve) => {
      let data = ""; req.on("data", (c) => (data += c)); req.on("end", () => resolve(data || ""));
    });
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }

  const { prompt, history = [], context = "" } = await readBody();
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const key = process.env.PPLX_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing PPLX_API_KEY" });

  // Build a single system message with optional context
  const systemParts = [
    "You are a helpful civic assistant for California propositions.",
    "Be concise: reply in either 3–5 short hyphen bullets or 3–4 sentences.",
    "No bold markdown, no bracket citations.",
  ];
  if (context && typeof context === "string") {
    systemParts.push("Context:\n" + context.trim());
  }
  const systemMessage = { role: "system", content: systemParts.join("\n\n") };

  // Clean/limit history and ensure roles alternate (user/assistant)
  const cleaned = [];
  let lastRole = null;
  for (const t of Array.isArray(history) ? history.slice(-12) : []) {
    const r = (t.role || "").toLowerCase();
    const c = (t.content || "").toString();
    if (!c) continue;
    if (r !== "user" && r !== "assistant") continue;
    if (r === lastRole) continue;
    cleaned.push({ role: r, content: c });
    lastRole = r;
  }

  const messages = [systemMessage, ...cleaned, { role: "user", content: prompt }];

  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar", // or "sonar-pro" if your plan supports
        messages,
        temperature: 0.2,
      }),
    });

    const data = await r.json();

    if (data?.error) {
      return res.status(200).json({
        answer: `API error: ${data.error?.message || "unknown error"}`,
        debug: data,
      });
    }

    let text =
      data?.choices?.[0]?.message?.content ||
      data?.output_text ||
      "";

    text = (text || "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\[(\d+)\]/g, "")
      .trim();

    if (!text) {
      return res.status(200).json({ answer: "No response.", debug: data });
    }
    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

