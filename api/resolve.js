// api/zip/resolve.js
export default async function handler(req, res) {
  // let Flutter talk to it safely
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // read the incoming ZIP
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  const zip = body.zip;

  if (!/^\d{5}$/.test(zip || "")) {
    return res.status(400).json({ error: "invalid_zip", message: "Enter 5 digits" });
  }

  // use your same Perplexity key
  const key = process.env.PPLX_API_KEY;
  if (!key) return res.status(500).json({ error: "missing_api_key" });

  // this tells the AI exactly what to send back
  const system = `
You are a civic data helper.
Return ONLY JSON like this:
{
 "zip": "94539",
 "normalized_city": "Fremont",
 "normalized_county": "Alameda",
 "districts": {
   "us_house": [{"id": "CA-17"}],
   "state_senate": [{"id": "SD-10"}],
   "state_assembly": [{"id": "AD-24"}]
 },
 "needs_address": false
}
If the ZIP isn't in California, say needs_address=true and add a "message".
No explanations, just JSON.
  `;

  const user = `ZIP: ${zip}`;

  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  const data = await r.json();
  const raw = data?.choices?.[0]?.message?.content || "";

  // clean & parse the JSON
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return res.status(200).json({ error: "ai_parse_failed", raw });
  }

  parsed.inferred = true; // mark as AI-based guess
  res.status(200).json(parsed);
}

