// /api/perplexity.js

export default async function handler(req, res) {
  // --- CORS for Flutter web & local testing ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Origin, Cache-Control, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // --- Robust JSON body parsing (handles raw bodies) ---
  async function readBody() {
    if (req.body && typeof req.body === "object") return req.body;
    const raw = await new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data || ""));
    });
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }

  const { prompt, history = [] } = await readBody();
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const key = process.env.PPLX_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing PPLX_API_KEY" });

  // --- Build messages (system + cleaned history + current user prompt) ---
  const base = [
    {
      role: "system",
      content:
        "You are a concise civic assistant for California voters. If user context includes 'Context: User districts — ...' or a proposition line, incorporate it. Keep answers short (<=6 sentences or 3–6 plain hyphen bullets). No bold markdown, no [1] style citations.",
    },
    // take last 10 turns max to keep requests small
    ...((Array.isArray(history) ? history : []).slice(-10)
      // coerce to the shape Perplexity expects
      .map(h => ({ role: h?.role === "assistant" ? "assistant" : "user", content: String(h?.content ?? "").trim() }))
      // drop empties
      .filter(m => m.content.length > 0)),
    { role: "user", content: prompt.trim() },
  ];

  // Ensure strict alternation (user/assistant/user/…); Perplexity is picky
  const messages = [];
  for (const m of base) {
    if (!m.content) continue;
    if (messages.length && messages[messages.length - 1].role === m.role) {
      // skip duplicates-in-a-row
      continue;
    }
    messages.push(m);
  }

  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",          // valid public model
        messages,
        temperature: 0.2,
        max_tokens: 900,
      }),
    });

    const data = await r.json();

    // Bubble up API errors clearly (helps you debug from Flutter)
    if (!r.ok || data?.error) {
      return res.status(r.status || 200).json({
        answer: "No response.",
        debug: { error: data?.error || data || { status: r.status } },
      });
    }

    let text =
      data?.choices?.[0]?.message?.content
      ?? data?.output_text
      ?? "";

    // Clean bold + numeric footnotes
    text = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\[(\d+)\]/g, "")
      .trim();

    if (!text) {
      return res.status(200).json({ answer: "No response.", debug: data });
    }
    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ answer: "No response.", debug: { error: String(e) } });
  }
}
