// Igual que api/sheet.js, pero apunta a la hoja "Las Colonias" del mismo
// Google Sheet. Cuando se publica el documento completo (no una hoja
// suelta), cada pestaña se distingue agregando su "gid" a la misma URL
// de publicación, con &single=true para traer solo esa hoja.

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQlW8M_Suqq4x6B4M7Rdlk26RS1KwOJ5mh9os5_8avPMXQpdZ6hzoVMhiXqXSmKliSxnWx128SDWA7O/pub?gid=1062119892&single=true&output=csv";

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
