// Mobile King 5-Branch — API (Netlify Functions v2 + Netlify Blobs)
// Env vars (Netlify > Site configuration > Environment variables):
//   GM_PASSWORD   – GM login password (required)
//   TOKEN_SECRET  – long random string used to sign login tokens (required)
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const MANUAL_NUM = ["walkin", "followup", "complaints", "stockout"];
const MANUAL_TXT = ["stockoutNote", "q1", "q2", "q3"];
const TASK_COUNT = 10;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_SETTINGS = {
  workDays: 30,
  branches: [
    { id: "b1", name: "Main Showroom", incharge: "", posLoc: "Mobile King", monthly: 9000, pin: "" },
    { id: "b2", name: "Showroom 1", incharge: "", posLoc: "Showroom 1", monthly: 2000, pin: "" },
    { id: "b3", name: "Showroom 2", incharge: "", posLoc: "Showroom 2", monthly: 2000, pin: "" },
    { id: "b4", name: "Showroom 3", incharge: "", posLoc: "Showroom 3", monthly: 6000, pin: "" },
    { id: "b5", name: "Showroom 4", incharge: "", posLoc: "Showroom 4", monthly: 2000, pin: "" },
  ],
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function secret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 16) throw new Error("TOKEN_SECRET env var is missing or too short");
  return s;
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function loadGM(store) {
  const s = (await store.get("gm/state", { type: "json" })) || {};
  if (!s.settings) s.settings = structuredClone(DEFAULT_SETTINGS);
  for (const k of ["reports", "scores", "training"]) if (!s[k]) s[k] = {};
  if (!s.road) s.road = { status: [], succ: [] };
  if (!s.imports) s.imports = [];
  return s;
}
const monthsBack = (n) => {
  const out = [], d = new Date();
  for (let i = 0; i < n; i++) { out.push(new Date(d.getFullYear(), d.getMonth() - i, 15).toISOString().slice(0, 7)); }
  return out;
};

function cleanReport(r) {
  const o = {};
  for (const k of MANUAL_NUM) { const v = Math.floor(Number(r?.[k])); o[k] = Number.isFinite(v) && v >= 0 && v < 100000 ? v : 0; }
  for (const k of MANUAL_TXT) o[k] = String(r?.[k] ?? "").slice(0, 1500);
  return o;
}

async function rateLimited(store, ip) {
  const key = "rl/" + crypto.createHash("sha256").update(ip || "x").digest("hex").slice(0, 24);
  const rec = (await store.get(key, { type: "json" })) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = Date.now(); }
  return { key, rec, blocked: rec.n >= 10 };
}

export default async (req, context) => {
  try {
    const store = getStore({ name: "mobileking", consistency: "strong" });
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    const method = req.method;

    // ---------- login ----------
    if (route === "login" && method === "POST") {
      const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "";
      const rl = await rateLimited(store, ip);
      if (rl.blocked) return json({ error: "Login အကြိမ်များလွန်းသည် — ၁၅ မိနစ်ခန့် စောင့်ပြီး ပြန်ကြိုးစားပါ" }, 429);
      const { pin } = await req.json().catch(() => ({}));
      const code = String(pin || "").trim();
      if (!process.env.GM_PASSWORD) return json({ error: "GM_PASSWORD env var not set on Netlify" }, 500);
      let payload = null;
      if (code && safeEq(code, process.env.GM_PASSWORD)) payload = { role: "gm", exp: Date.now() + 7 * 864e5 };
      else if (code) {
        const gm = await loadGM(store);
        const b = gm.settings.branches.find((x) => x.pin && safeEq(code, x.pin));
        if (b) payload = { role: "branch", bid: b.id, exp: Date.now() + 30 * 864e5 };
      }
      if (!payload) {
        rl.rec.n++; await store.setJSON(rl.key, rl.rec);
        return json({ error: "PIN / Password မှားနေသည်" }, 401);
      }
      return json({ token: sign(payload), role: payload.role, bid: payload.bid || null });
    }

    // ---------- auth ----------
    const auth = verify((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
    if (!auth) return json({ error: "unauthorized" }, 401);

    // ---------- In-charge ----------
    if (route === "ic/data" && method === "GET") {
      if (auth.role !== "branch") return json({ error: "forbidden" }, 403);
      const gm = await loadGM(store);
      const b = gm.settings.branches.find((x) => x.id === auth.bid);
      if (!b) return json({ error: "Branch removed — GM ကို ဆက်သွယ်ပါ" }, 403);
      const reports = {}, checklist = {};
      for (const m of monthsBack(2)) {
        const blob = await store.get(`ic/${b.id}/${m}`, { type: "json" });
        if (blob) { Object.assign(reports, blob.reports || {}); Object.assign(checklist, blob.checklist || {}); }
      }
      const dailyTarget = Math.round(((+b.monthly || 0) / (+gm.settings.workDays || 30)) * 100) / 100;
      return json({ branch: { id: b.id, name: b.name, incharge: b.incharge || "", dailyTarget }, reports, checklist });
    }
    if (route === "ic/save" && method === "POST") {
      if (auth.role !== "branch") return json({ error: "forbidden" }, 403);
      const body = await req.json().catch(() => ({}));
      const date = String(body.date || "");
      if (!DATE_RX.test(date)) return json({ error: "bad date" }, 400);
      const key = `ic/${auth.bid}/${date.slice(0, 7)}`;
      const blob = (await store.get(key, { type: "json" })) || { reports: {}, checklist: {} };
      if (body.report) blob.reports[date] = { ...cleanReport(body.report), ts: Date.now() };
      if (Array.isArray(body.checklist)) blob.checklist[date] = Array.from({ length: TASK_COUNT }, (_, i) => !!body.checklist[i]);
      await store.setJSON(key, blob);
      return json({ ok: true, ts: Date.now() });
    }

    // ---------- GM ----------
    if (auth.role !== "gm") return json({ error: "forbidden" }, 403);
    if (route === "gm/state" && method === "GET") {
      const gm = await loadGM(store);
      const ic = {};
      const { blobs } = await store.list({ prefix: "ic/" });
      await Promise.all(blobs.map(async ({ key }) => {
        const [, bid] = key.split("/");
        const v = await store.get(key, { type: "json" });
        if (!v) return;
        ic[bid] = ic[bid] || { reports: {}, checklist: {} };
        Object.assign(ic[bid].reports, v.reports || {});
        Object.assign(ic[bid].checklist, v.checklist || {});
      }));
      return json({ state: gm, incharge: ic });
    }
    if (route === "gm/state" && method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body || !body.settings || !Array.isArray(body.settings.branches)) return json({ error: "bad state" }, 400);
      const st = { settings: body.settings, reports: body.reports || {}, scores: body.scores || {}, training: body.training || {}, road: body.road || { status: [], succ: [] }, imports: (body.imports || []).slice(0, 20), savedAt: Date.now() };
      const size = JSON.stringify(st).length;
      if (size > 4.5e6) return json({ error: "state too large" }, 413);
      await store.setJSON("gm/state", st);
      return json({ ok: true, savedAt: st.savedAt });
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
};
