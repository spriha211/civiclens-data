export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const perplexityKey = process.env.PPLX_API_KEY;

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${perplexityKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-medium-online", // or sonar-large for best accuracy
        messages: [
          { role: "system", content: "You are an expert civic assistant helping explain California propositions." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content ?? "No response.";

    res.status(200).json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
