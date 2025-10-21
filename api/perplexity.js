export default async function handler(req, res) {
  // --- CORS (for Flutter web) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Origin, Cache-Control, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // --- Robust JSON body parsing (works even if body isn't auto-parsed) ---
  async function readBody() {
    if (req.body && typeof req.body === "object") return req.body;
    const raw = await new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data || ""));
    });
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }

  const { prompt, history } = await readBody();
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const key = process.env.PPLX_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing PPLX_API_KEY" });

  // Build messages (use last 10 turns of history for context)
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful civic assistant for California propositions. Use prior turns for context. Be concise: 3–5 short bullets or 3–4 sentences. No bold markdown, no bracketed [1] citations, plain hyphen bullets only.",
    },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: "user", content: prompt },
  ];

  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",            // or "sonar-pro" if your plan supports it
        messages,
        // temperature: 0.2,       // optional: make answers steadier
      }),
    });

    const data = await r.json();

    // If Perplexity returned an error, surface it clearly
    if (data?.error) {
      return res.status(200).json({
        answer: `API error: ${data.error?.message || "unknown error"}`,
        debug: data,
      });
    }

    // Try multiple shapes for content
    let text =
      data?.choices?.[0]?.message?.content ||
      data?.output_text ||
      "";

    // Clean markdown/citations
    text = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\[(\d+)\]/g, "")
      .trim();

    if (!text) {
      return res.status(200).json({
        answer: "No response.",
        debug: data,   // keep this so we can see what came back if empty
      });
    }

    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
