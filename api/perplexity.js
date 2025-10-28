export default async function handler(req, res) {
  // CORS for Flutter web
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin, Cache-Control, X-Requested-With");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  async function readBody() {
    if (req.body && typeof req.body === "object") return req.body;
    const raw = await new Promise((resolve) => {
      let data = ""; req.on("data", c => data += c); req.on("end", () => resolve(data || ""));
    });
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }

  const { prompt } = await readBody();
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const key = process.env.PPLX_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing PPLX_API_KEY" });

  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system",
            content:
              "You are a helpful civic assistant for California ballot propositions and districts. Be concise: 3–5 short bullets or 3–4 short sentences. No bold, no bracketed [1] citations." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });

    const data = await r.json();
    const text = (data?.choices?.[0]?.message?.content || data?.output_text || "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\[(\d+)\]/g, "")
      .trim();

    if (!text) return res.status(200).json({ answer: "No response.", debug: data });
    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

