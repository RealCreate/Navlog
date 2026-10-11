// Saved plans (on this device) and the copy of the plan hidden inside every PDF the app makes,
// so a navlog PDF can be opened again later — even on another device — and its winds updated.

const KEY = 'navlog.plans.v1';
const TAG = 'navlog-plan:';

export function listPlans() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function savePlan(name, data, id) {
  const list = listPlans();
  const entry = { id: id || `p${Date.now()}`, name, saved: new Date().toISOString(), data };
  const i = list.findIndex((p) => p.id === entry.id);
  if (i >= 0) list[i] = entry; else list.unshift(entry);
  store(list.slice(0, 50));
  return entry.id;
}
export function deletePlan(id) { store(listPlans().filter((p) => p.id !== id)); }
export function getPlan(id) { return listPlans().find((p) => p.id === id) || null; }

const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s) => decodeURIComponent(escape(atob(s)));

/** Embed the plan JSON in a pdf-lib document (keywords metadata). */
export function embedPlan(doc, data) {
  doc.setKeywords([TAG + b64(JSON.stringify(data))]);
  doc.setCreator('Navlog — realcreate.github.io/Navlog');
}

/** Read a plan back from PDF bytes, or null if the PDF was not made by the app. */
export async function planFromPdf(bytes) {
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const kw = doc.getKeywords() || '';
  const i = kw.indexOf(TAG);
  if (i < 0) return null;
  const raw = kw.slice(i + TAG.length).split(/[\s,;]/)[0];
  return JSON.parse(unb64(raw));
}
