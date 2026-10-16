// Función de Supabase "pasos": la llama un Atajo del iPhone con los pasos del día que lee de la app Salud.
// Uso: GET o POST  .../functions/v1/<esta-funcion>?t=<código de la persona>&p=<pasos>   (opcional &f=AAAA-MM-DD)
// El código de cada persona se crea en Ajustes de la app y se guarda en la configuración. Requiere "Verify JWT" apagado.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });

// "8.234", "8234 pasos", "8,234" -> 8234
function parsePasos(v: unknown): number | null {
  const m = String(v ?? "").match(/[\d.,]+/);
  if (!m) return null;
  const limpio = m[0].replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Math.round(parseFloat(limpio));
  return Number.isFinite(n) && n >= 0 && n < 200000 ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const u = new URL(req.url);
    let t = u.searchParams.get("t"), p: unknown = u.searchParams.get("p"), f = u.searchParams.get("f");
    if (req.method === "POST") {
      try { const b = await req.json(); t = b.t ?? t; p = b.p ?? p; f = b.f ?? f; } catch { /* sin cuerpo */ }
    }
    const pasos = parsePasos(p);
    if (!t || pasos == null) return json({ error: "Faltan el código (t) o los pasos (p)." }, 400);

    const SB = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };
    const cfg = await (await fetch(`${SB}/rest/v1/registros?id=eq.config&select=data`, { headers: h })).json();
    const people = cfg?.[0]?.data?.people || {};
    const pid = Object.keys(people).find((k) => people[k]?.stepsToken && people[k].stepsToken === t);
    if (!pid) return json({ error: "Código inválido. Volvé a copiar el link desde Ajustes." }, 401);

    const fecha = f && /^\d{4}-\d{2}-\d{2}$/.test(f)
      ? f
      : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    const id = `${pid}_${fecha}`;
    const cur = await (await fetch(`${SB}/rest/v1/registros?id=eq.${id}&select=data`, { headers: h })).json();
    const d = cur?.[0]?.data || { person: pid, date: fecha, meals: {}, train: false, steps: false, kg: null };
    d.stepsCount = pasos;
    d.steps = pasos >= 10000;
    d.stepsAt = new Date().toISOString();
    const r = await fetch(`${SB}/rest/v1/registros`, {
      method: "POST",
      headers: { ...h, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id, data: d, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return json({ error: "No se pudo guardar: " + (await r.text()).slice(0, 200) }, 500);
    return json({ ok: true, persona: people[pid].name, fecha, pasos });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
