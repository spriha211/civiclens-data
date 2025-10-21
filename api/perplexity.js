export default async function handler(req, res) {
  // CORS for Flutter web
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  const key = process.env.PPLX_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing PPLX_API_KEY" });

  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar", 
        messages: [
          { role: "system", content: "You are a helpful civic assistant for California propositions. Prefer concise, source-aware answers." },
          { role: "user", content: prompt }
        ]
      }),
    });

    const data = await r.json();

    // Try multiple shapes just in case
    const fromChoices = data?.choices?.[0]?.message?.content;
    const fromOutput = data?.output_text;
    const text = (fromChoices || fromOutput || "").toString().trim();

    if (!text) {
      // helpful debug payload (temporarily; remove later if you want)
      return res.status(200).json({
        answer: "No response.",
        debug: data
      });
    }

    return res.status(200).json({ answer: text });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

