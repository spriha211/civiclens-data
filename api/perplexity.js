export default async function handler(req, res) {
  // CORS for Flutter web
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { prompt, history } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  const key = process.env.PPLX_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing PPLX_API_KEY" });

  // Build messages array with prior turns (user/assistant) + current prompt.
  // Expect history like: [{role:"user", content:"..."}, {role:"assistant", content:"..."}]
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful civic assistant for California propositions. Use prior turns for context. Be concise: 3–6 short bullets or 4 sentences max. No markdown bold, no [1] citations, no URLs unless asked. Use plain hyphen '-' bullets.",
    },
    ...(Array.isArray(history) ? history.slice(-10) : []), // last 10 turns max
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
        model: "sonar", // or "sonar-pro" if your plan supports it
        messages,
        // temperature: 0.2, // optional: steadier answers
      }),
    });

    const data = await r.json();
    const text =
      data?.choices?.[0]?.message?.content ||
      data?.output_text ||
      "";

    // basic cleanup: strip **bold** and [#] citations
    const cleaned = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\[(\d+)\]/g, "")
      .trim();

    if (!cleaned) {
      return res.status(200).json({ answer: "No response.", debug: data });
    }
    return res.status(200).json({ answer: cleaned });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}


