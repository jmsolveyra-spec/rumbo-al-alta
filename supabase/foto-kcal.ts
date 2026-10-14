// Función de Supabase "foto-kcal": recibe la foto de un plato y le pide a Gemini (Google) que separe los alimentos y estime gramos.
// La clave de Gemini vive en los Secrets de Supabase (GEMINI_API_KEY), nunca en la app.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "Falta cargar GEMINI_API_KEY en los Secrets de Supabase." }, 500);
    const { image, mime, foods } = await req.json();
    if (!image || image.length > 5_000_000) return json({ error: "La foto no llegó o es demasiado grande." }, 400);
    const lista = Array.isArray(foods) ? foods.slice(0, 400).join("; ") : "";
    const prompt =
      "Sos nutricionista en Argentina. Mirá la foto de una comida e identificá CADA alimento visible por separado " +
      "(carne, guarnición, cada verdura de la ensalada, pan, salsas, bebidas). Si la comida brilla o tiene aderezo, sumá el aceite estimado. " +
      "Estimá el peso en gramos (o ml si es líquido) de cada uno según el tamaño del plato, los cubiertos y la mano. " +
      "Cuando un alimento coincida con esta lista, usá EXACTAMENTE ese nombre: " + lista + ". " +
      "Si no está en la lista, poné un nombre corto en español y estimá sus kcal. " +
      'Respondé solo JSON con esta forma: {"items":[{"nombre":string,"gramos":number,"kcal":number|null,"en_lista":boolean}],"nota":string}. ' +
      '"nota" es una frase corta sobre lo que no se ve bien (por ejemplo si no se sabe cuánto aceite tiene). Si la foto no muestra comida, devolvé items vacío.';
    // Si un modelo no existe o está saturado, se prueba el siguiente.
    const models = [Deno.env.get("GEMINI_MODEL"), "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.0-flash"].filter(Boolean);
    let last = "";
    for (const m of models) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime || "image/jpeg", data: image } }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if ([404, 429, 500, 503].includes(r.status)) { last = `${m}: ${j?.error?.message || r.status}`; continue; }
      if (!r.ok) return json({ error: j?.error?.message || "Gemini devolvió un error.", status: r.status }, 502);
      const txt = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
      try {
        const out = JSON.parse(txt.replace(/^\s*```(json)?/, "").replace(/```\s*$/, ""));
        return json({ items: out.items || [], nota: out.nota || "", model: m });
      } catch {
        return json({ error: "No se pudo leer la respuesta de Gemini.", raw: txt.slice(0, 300) }, 502);
      }
    }
    const ocupado = /quota|rate|exhaust|demand|overload/i.test(last);
    return json({ error: ocupado ? "Google está saturado o se alcanzó el límite gratis. Probá de nuevo en unos minutos o cargalo a mano." : "Ningún modelo de Gemini disponible (" + last + ")." }, 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
