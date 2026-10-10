# Navlog

Personal VFR navigation-log planner, built to follow the flight school's SOPs
(Phase 2 Training Manual — Flight Planning Manual) to the letter.

Live: https://realcreate.github.io/Navlog/ (installable on iPad: Share → Add to Home Screen)

## What it does

- Opens on the **ENAIRE VFR 1:500 000 chart** (AIP España) centred on Burgos (LEBG).
- Tap the chart to add waypoints (SkyDemon style). Tapping a VRP or aerodrome snaps to it;
  tapping the departure aerodrome again closes the route. Drag a waypoint to move it,
  drag the dot in the middle of a leg to insert a point.
- Builds the navlog exactly like the school form / LNAV Excel: TC, VAR/MC, ALT, TAS, wind,
  WCA/MH, distance leg/remaining, GS, ETE, fuel/remaining, with automatic TOC/TOD rows.
- Date & time slider for the flight, with sunrise/sunset and landing-time check.
- Main route + alternate route, fuel policy check, P2008 mass & balance.
- **Navlog PDF** fills the school's "Visual Operational Flight Plan" form.
- Works offline after loading; "Save chart for offline" caches the chart around the route.

## SOP rules implemented (Flight Planning Manual – Navigation Log)

| Item | Rule |
| --- | --- |
| TAS | 90 kt + 2 kt per 1000 ft; climb 75 kt; descent 85 kt |
| TOC / TOD | 500 ft/min, distance from Ground Speed (rounded up to 0.5 NM) |
| Magnetic | MC = TC − VAR E (+ VAR W); MH = MC ± WCA |
| GS | headwind subtracts, tailwind adds (cos wind angle × wind speed) |
| ETE | Dist / GS |
| Standard times | departure 20 min, arrival 15 min (SEP & MEP) |
| Fuel rates | cruise 18 L/h, climb 23 L/h, descent 12 L/h (general rule — check POH) |
| Fuel policy | taxi, trip, alternate, contingency 5 % trip, final reserve 45 min, extra |
| Local flights | ≤ 90 min → fuel for 135 flight minutes |
| Units | fuel in litres, mass in kg |
| Winds | approved sources only: windy.com, ama.aemet.es |

## Chart tiles

`tools/build-tiles.sh` runs in GitHub Actions: it downloads the current LE1 Norte and
LE4 Centronorte GeoTIFFs from the AIP España page, reprojects them and cuts WebP tiles
(zoom 6–12). Tiles are cached between runs and rebuilt automatically when ENAIRE
publishes a new edition (checked weekly). Chart data © ENAIRE.

## Development

```
python3 -m http.server   # then open http://localhost:8000
npm test                 # navlog calculation tests
```

Not for operational use without cross-checking against official documents.
