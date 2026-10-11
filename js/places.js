// Town and village names drawn over the chart (GeoNames data, built in CI into
// data/places.json as [name, lat, lon, rank]; rank 0 = city, 1 = town, 2 = village).
// Labels are decluttered so they never overlap each other.

const L = window.L;

const MIN_ZOOM = [6, 8, 10]; // first zoom at which each rank appears

export const PlacesLayer = L.Layer.extend({
  initialize(places) { this._places = places; },

  getAttribution() { return 'Names © <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a>'; },

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
    L.DomUtil.remove(this._canvas);
  },

  _hide() { this._canvas.style.visibility = 'hidden'; },

  _redraw() {
    const map = this._map, c = this._canvas;
    const size = map.getSize(), dpr = window.devicePixelRatio || 1;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(c, topLeft);
    c.width = size.x * dpr; c.height = size.y * dpr;
    c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
    c.style.visibility = '';
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const z = map.getZoom();
    const b = map.getBounds().pad(0.05);
    const boxes = [];
    const hit = (r) => boxes.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const [name, lat, lon, rank] of this._places) {
      if (z < MIN_ZOOM[rank]) continue;
      if (lat < b.getSouth() || lat > b.getNorth() || lon < b.getWest() || lon > b.getEast()) continue;
      const p = map.latLngToContainerPoint([lat, lon]);
      // Chart-style labels: small, light, with a thin halo so they never overpower the chart.
      const size = rank === 0 ? 11.5 : rank === 1 ? 10.5 : 9.5;
      const weight = rank === 0 ? 700 : rank === 1 ? 600 : 500;
      ctx.font = `${weight} ${size}px -apple-system, "SF Pro Text", system-ui, sans-serif`;
      const text = rank === 0 ? name.toUpperCase() : name;
      if (rank === 0) ctx.letterSpacing = '0.06em'; else ctx.letterSpacing = '0px';
      const w = ctx.measureText(text).width + 4;
      const box = { x: p.x - w / 2, y: p.y - size - 5, w, h: size + 3 };
      if (hit(box)) continue;
      boxes.push(box);
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(text, p.x, p.y - size / 2 - 3);
      ctx.fillStyle = rank === 0 ? 'rgba(25,25,30,0.9)' : rank === 1 ? 'rgba(35,35,42,0.85)' : 'rgba(55,55,62,0.8)';
      ctx.fillText(text, p.x, p.y - size / 2 - 3);
      if (rank === 2) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(55,55,62,0.7)'; ctx.fill(); }
    }
  },
});
