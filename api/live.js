// Serverless (Vercel) — jala citas REALES de Be Well Esthetic desde GoHighLevel.
// El token vive solo aquí (env encriptadas), NUNCA en la página pública.
// Devuelve agregados + una muestra con nombres enmascarados (privacidad).

const LC = "https://services.leadconnectorhq.com";
let CACHE = { at: 0, data: null }; // cache en memoria del lambda (~2 min)

function maskName(n) {
  if (!n) return "Cliente";
  const clean = String(n).replace(/[^\p{L}\p{N} .]/gu, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return "Cliente";
  const first = parts[0];
  const initial = parts[1] ? " " + parts[1][0].toUpperCase() + "." : "";
  return (first.length > 14 ? first.slice(0, 14) : first) + initial;
}

async function freshToken() {
  const rt = process.env.BEWELL_REFRESH_TOKEN;
  const key = process.env.BEWELL_API_KEY;
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}`,
  });
  if (!r.ok) throw new Error("refresh " + r.status);
  const j = await r.json();
  if (!j.id_token) throw new Error("sin id_token");
  return j.id_token;
}

async function pull() {
  const loc = process.env.BEWELL_LOCATION;
  const tk = await freshToken();
  const H = { "token-id": tk, channel: "APP", source: "WEB_USER", version: "2021-07-28" };
  const g = async (u) => {
    const r = await fetch(u, { headers: H });
    if (!r.ok) throw new Error("ghl " + r.status);
    return r.json();
  };

  const cj = await g(`${LC}/calendars/?locationId=${loc}`);
  const cals = cj.calendars || [];

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = now.getTime() + 3 * 864e5;

  let ev = [];
  for (const c of cals) {
    try {
      const j = await g(`${LC}/calendars/events?locationId=${loc}&calendarId=${c.id}&startTime=${start}&endTime=${end}`);
      (j.events || []).forEach((e) => ev.push(e));
    } catch (e) { /* seguir con otros calendarios */ }
  }

  const by = { showed: 0, confirmed: 0, noshow: 0, cancelled: 0, new: 0 };
  ev.forEach((e) => {
    const s = e.appointmentStatus || "new";
    if (by[s] === undefined) by[s] = 0;
    by[s]++;
  });
  const total = ev.length;
  const cerradas = by.showed || 0;
  const conv = total ? Math.round((cerradas / total) * 100) : 0;

  ev.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  const muestra = ev.slice(0, 8).map((e) => ({
    fecha: (e.startTime || "").slice(0, 16).replace("T", " "),
    cliente: maskName(e.title || e.contactName),
    estado: e.appointmentStatus || "new",
  }));

  return { total, cerradas, conv, by, muestra, ts: Date.now() };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const now = Date.now();
    if (CACHE.data && now - CACHE.at < 120000) {
      return res.status(200).json({ ...CACHE.data, cached: true });
    }
    const data = await pull();
    CACHE = { at: now, data };
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).json({ error: String(e.message || e), live: false });
  }
};
