// Vercel Serverless Function (Node.js runtime).
// Fetches the published Google Sheet CSV *server-side* and hands it to the
// browser as JSON. This exists because Google's "publish to web" CSV
// endpoint redirects to googleusercontent.com and does not send
// Access-Control-Allow-Origin headers, so calling it directly from
// client-side JS on a different origin (e.g. your-app.vercel.app) fails
// with a CORS error. A server-to-server fetch has no such restriction.

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQlW8M_Suqq4x6B4M7Rdlk26RS1KwOJ5mh9os5_8avPMXQpdZ6hzoVMhiXqXSmKliSxnWx128SDWA7O/pub?output=csv";

module.exports = async (req, res) => {
  try {
    const upstream = await fetch(`${CSV_URL}&_ts=${Date.now()}`, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SheetProxy/1.0)" }
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `El Sheet respondió HTTP ${upstream.status}` });
      return;
    }

    const csv = await upstream.text();
    const lastModified = upstream.headers.get("last-modified") || null;

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      csv,
      lastModified,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || "Error desconocido al obtener el Sheet" });
  }
};
