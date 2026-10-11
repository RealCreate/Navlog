// Town and village names drawn over the chart (GeoNames data, built in CI into
// data/places.json as [name, lat, lon, rank]; rank 0 = city, 1 = town, 2 = village).
// Labels are decluttered so they never overlap each other.
//
// Two looks: 'rogers' on the app's own chart (as on the Rogers Data VFR charts: cities in bold
// spaced capitals, towns in bold condensed type beside a ring, villages small beside a dot, on a
// soft light halo) and 'light' on the ENAIRE chart, whose own names are already printed.

const L = window.L;

const MIN_ZOOM = [6, 8, 10]; // first zoom at which each rank appears
const COND = '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';

/**
 * Draws place names on ctx. P(lat, lon) → [x, y]; z: zoom; k: scale (1 screen, more for print).
 * boxes: list of occupied rectangles (labels are skipped where they would overlap).
 */
export function drawPlaces(ctx, places, P, z, { k = 1, style = 'rogers', inView = () => true, boxes = [] } = {}) {
  const hit = (r) => boxes.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.textBaseline = 'middle';
  const order = places.length < 2 || places.every((p, i) => i === 0 || places[i - 1][3] <= p[3]) ? places : [...places].sort((a, b) => a[3] - b[3]);
  for (const [name, lat, lon, rank] of order) {
    if (z < MIN_ZOOM[rank] || !inView(lat, lon)) continue;
    const [x, y] = P(lat, lon);
    if (style === 'rogers') {
      // city: BOLD SPACED CAPITALS centred; town: bold condensed beside a ring; village: small beside a dot
      const big = z >= 9;
      const size = (rank === 0 ? (big ? 17 : 13.5) : rank === 1 ? (z >= 11 ? 13.5 : 12) : z >= 12 ? 11.5 : 10.5) * k;
      const weight = rank === 0 ? 800 : rank === 1 ? 700 : 500;
      ctx.font = `${weight} ${size}px ${COND}`;
      ctx.letterSpacing = rank === 0 ? `${0.12 * size}px` : '0px';
      const text = rank === 0 ? name.toUpperCase() : name;
      const w = ctx.measureText(text).width;
      // candidate spots: cities centred, then above/below; towns and villages right of the symbol, then left
      const gap = (rank === 1 ? 6 : 4.5) * k;
      const spots = rank === 0
        ? [[x - w / 2, y], [x - w / 2, y - size * 1.1], [x - w / 2, y + size * 1.1], [x + 4 * k, y - size * 0.8], [x - w - 4 * k, y - size * 0.8]]
        : [[x + gap, y - 1 * k], [x - gap - w, y - 1 * k], [x - w / 2, y - size * 1.05], [x - w / 2, y + size * 1.05]];
      let tx, ty, box;
      for (const [sx, sy] of spots) {
        const b = { x: sx - 2 * k, y: sy - size * 0.62, w: w + 4 * k, h: size * 1.24 };
        if (!hit(b)) { tx = sx; ty = sy; box = b; break; }
      }
      if (!box) continue;
      boxes.push(box);
      if (rank === 1) { // town ring
        ctx.lineWidth = 1.6 * k; ctx.strokeStyle = '#26262e'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(x, y, 3 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (rank === 2) {
        ctx.fillStyle = '#3a3a44'; ctx.beginPath(); ctx.arc(x, y, 1.7 * k, 0, Math.PI * 2); ctx.fill();
      }
      ctx.textAlign = 'left';
      ctx.lineWidth = (rank === 0 ? 3.6 : 3) * k; ctx.strokeStyle = 'rgba(255,253,240,0.82)';
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = rank === 0 ? '#16161c' : rank === 1 ? '#202028' : '#36363f';
      ctx.fillText(text, tx, ty);
    } else {
      // light labels for the ENAIRE chart (its own names are printed underneath)
      const size = (rank === 0 ? 11.5 : rank === 1 ? 10.5 : 9.5) * k;
      const weight = rank === 0 ? 700 : rank === 1 ? 600 : 500;
      ctx.font = `${weight} ${size}px -apple-system, "SF Pro Text", system-ui, sans-serif`;
      const text = rank === 0 ? name.toUpperCase() : name;
      ctx.letterSpacing = rank === 0 ? '0.06em' : '0px';
      const w = ctx.measureText(text).width + 4;
      const box = { x: x - w / 2, y: y - size - 5, w, h: size + 3 };
      if (hit(box)) continue;
      boxes.push(box);
      ctx.textAlign = 'center';
      ctx.lineWidth = 1.6 * k; ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeText(text, x, y - size / 2 - 3);
      ctx.fillStyle = rank === 0 ? 'rgb(30,30,36)' : rank === 1 ? 'rgb(40,40,48)' : 'rgb(60,60,68)';
      ctx.fillText(text, x, y - size / 2 - 3);
      if (rank === 2) { ctx.beginPath(); ctx.arc(x, y, 1.5 * k, 0, Math.PI * 2); ctx.fillStyle = 'rgba(55,55,62,0.7)'; ctx.fill(); }
    }
  }
  ctx.letterSpacing = '0px';
  ctx.restore();
}

export const PlacesLayer = L.Layer.extend({
  initialize(places, { avoid = () => [] } = {}) { this._places = places; this._style = 'rogers'; this._avoid = avoid; },

  getAttribution() { return 'Names © <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a>'; },

  setStyle(style) { if (style !== this._style) { this._style = style; if (this._map) this._redraw(); } return this; },

  onAdd(map) {
    this._map = map;
    const pane = map.getPane('labels') || map.createPane('labels');
    this._canvas = L.DomUtil.create('canvas', 'places-canvas leaflet-zoom-hide', pane);
    this._canvas.style.pointerEvents = 'none';
    map.on('moveend zoomend resize', this._redraw, this);
    map.on('zoomstart', this._hide, this);
    this._redraw();
  },

  onRemove(map) {
    map.off('moveend zoomend resize', this._redraw, this);
    map.off('zoomstart', this._hide, this);
    clearTimeout(this._retry);
    this._canvas.width = 0; this._canvas.height = 0;
    L.DomUtil.remove(this._canvas);
  },

  _hide() { this._canvas.style.visibility = 'hidden'; },

  _redraw() {
    const map = this._map, c = this._canvas;
    // at most 2× (Safari's canvas memory limit on iPhone/iPad; 3× adds nothing visible for text)
    const size = map.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(c, topLeft);
    c.width = size.x * dpr; c.height = size.y * dpr;
    c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
    c.style.visibility = '';
    const ctx = c.getContext('2d');
    if (!ctx) { // out of canvas memory: try again shortly (tiles are being freed)
      clearTimeout(this._retry); this._retry = setTimeout(() => this._map && this._redraw(), 800);
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = map.getBounds().pad(0.05);
    drawPlaces(ctx, this._places, (la, lo) => { const p = map.latLngToContainerPoint([la, lo]); return [p.x, p.y]; }, map.getZoom(), {
      style: this._style,
      boxes: this._avoid().slice(),
      inView: (lat, lon) => lat >= b.getSouth() && lat <= b.getNorth() && lon >= b.getWest() && lon <= b.getEast(),
    });
  },
});
