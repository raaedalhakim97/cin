import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Pick a work location on a map, and see the geofence radius drawn on it.
//
// Typing latitude and longitude by hand is not the real problem this solves.
// The problem is that a radius is impossible to judge as a number: 200m either
// reaches the car park and the loading bay or it does not, and the way you find
// out otherwise is fifty people unable to clock in. Drawn on a map next to the
// building, it is obvious.
//
// The numeric inputs stay the primary control — they are precise, keyboard
// accessible, and work if tiles fail to load. This is a second way in, not a
// replacement.
//
// OpenStreetMap raster tiles: no API key, no billing account, no per-load cost.
// Attribution is a licence condition, not decoration — do not remove it. Swapping
// to satellite imagery later is a one-line change to the tile URL, and needs a
// provider key.

// Dubai, used only when there is nothing else to centre on. A brand-new company
// with no coordinates and no saved sites has to start somewhere, and a map
// opening on the middle of the Atlantic reads as broken.
const FALLBACK_CENTRE = [25.2048, 55.2708]

// Leaflet's default marker is a PNG resolved relative to the stylesheet, which
// bundlers rewrite and then fail to find — the classic silently-missing-marker
// bug. An inline SVG divIcon has no asset to lose.
const PIN = L.divIcon({
  className: '',
  html: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 22s7-6.2 7-12A7 7 0 0 0 5 10c0 5.8 7 12 7 12z"
          fill="#00D4A0" stroke="#0F0F0F" stroke-width="1.2"/>
    <circle cx="12" cy="10" r="2.6" fill="#0F0F0F"/>
  </svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 26],
})

function isCoord(n) {
  return Number.isFinite(n) && Math.abs(n) > 0.0000001
}

export default function WorkLocationMap({
  latitude,
  longitude,
  radiusMetres,
  onPick,
  existing = [],
}) {
  const holder = useRef(null)
  const map = useRef(null)
  const marker = useRef(null)
  const ring = useRef(null)
  const others = useRef([])

  // onPick changes identity on every parent render. Held in a ref so the map is
  // built once — rebuilding a Leaflet instance on each keystroke in the latitude
  // field would fight the user for control of the viewport.
  const pick = useRef(onPick)
  useEffect(() => { pick.current = onPick }, [onPick])

  const lat = Number(latitude)
  const lng = Number(longitude)
  const hasPoint = isCoord(lat) && isCoord(lng)
  const radius = Number(radiusMetres) > 0 ? Number(radiusMetres) : 200

  // Build once.
  useEffect(() => {
    if (map.current || !holder.current) return

    const start = hasPoint
      ? [lat, lng]
      : existing.length
        ? [Number(existing[0].latitude), Number(existing[0].longitude)]
        : FALLBACK_CENTRE

    const m = L.map(holder.current, {
      center: start,
      zoom: hasPoint || existing.length ? 17 : 11,
      // A map inside a scrolling settings page must not swallow the page scroll.
      // Ctrl/⌘ + wheel still zooms, which Leaflet explains in its own overlay.
      scrollWheelZoom: false,
      attributionControl: true,
    })

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)

    m.on('click', (e) => pick.current?.(e.latlng.lat, e.latlng.lng))

    map.current = m

    // Leaflet measures its container on creation. Inside a tab that was hidden,
    // or before fonts settle, that measurement is wrong and the tiles render in
    // a strip. Re-measuring once the element has a real size fixes it.
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(holder.current)

    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      marker.current = null
      ring.current = null
      others.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The picked point and its radius.
  useEffect(() => {
    const m = map.current
    if (!m) return

    if (!hasPoint) {
      if (marker.current) { m.removeLayer(marker.current); marker.current = null }
      if (ring.current) { m.removeLayer(ring.current); ring.current = null }
      return
    }

    if (!marker.current) {
      marker.current = L.marker([lat, lng], {
        icon: PIN,
        draggable: true,
        keyboard: true,
        title: 'Drag to move this work location',
      }).addTo(m)
      marker.current.on('dragend', () => {
        const p = marker.current.getLatLng()
        pick.current?.(p.lat, p.lng)
      })
    } else {
      marker.current.setLatLng([lat, lng])
    }

    if (!ring.current) {
      ring.current = L.circle([lat, lng], {
        radius,
        color: '#00D4A0',
        weight: 2,
        fillColor: '#00D4A0',
        fillOpacity: 0.12,
      }).addTo(m)
    } else {
      ring.current.setLatLng([lat, lng])
      ring.current.setRadius(radius)
    }
  }, [lat, lng, hasPoint, radius])

  // Sites already saved, so a second location can be placed without overlapping
  // the first — two fences covering the same door means the nearest one wins and
  // the other never matches.
  useEffect(() => {
    const m = map.current
    if (!m) return

    others.current.forEach((l) => m.removeLayer(l))
    others.current = []

    existing.forEach((row) => {
      const rlat = Number(row.latitude)
      const rlng = Number(row.longitude)
      if (!isCoord(rlat) || !isCoord(rlng)) return
      const c = L.circle([rlat, rlng], {
        radius: Number(row.radius_metres) || 200,
        color: row.active ? '#4D9FFF' : '#A0A0A0',
        weight: 1,
        dashArray: '4 4',
        fillColor: row.active ? '#4D9FFF' : '#A0A0A0',
        fillOpacity: 0.06,
      }).addTo(m)
      c.bindTooltip(`${row.name}${row.active ? '' : ' (inactive)'} · ${row.radius_metres} m`)
      others.current.push(c)
    })
  }, [existing])

  return (
    <div>
      <div
        ref={holder}
        role="application"
        aria-label="Map for choosing a work location. Click or drag the pin to set the position. The latitude and longitude fields below do the same thing without a map."
        className="h-64 w-full rounded-xl overflow-hidden border border-[#E8E8E8] dark:border-[#2A2A2A] z-0
                   [&_.leaflet-container]:bg-[#F5F5F0] dark:[&_.leaflet-container]:bg-[#0F0F0F]
                   [&_.leaflet-control-attribution]:text-[10px]
                   [&_.leaflet-control-attribution]:bg-white/80
                   dark:[&_.leaflet-control-attribution]:bg-[#1E1E1E]/80
                   dark:[&_.leaflet-control-attribution]:text-[#A0A0A0]
                   dark:[&_.leaflet-tile-pane]:invert
                   dark:[&_.leaflet-tile-pane]:hue-rotate-180
                   dark:[&_.leaflet-tile-pane]:brightness-95
                   dark:[&_.leaflet-tile-pane]:contrast-[0.9]"
      />
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-2">
        {hasPoint
          ? `Click the map or drag the pin to move it. The filled circle is the ${radius} m radius — check it covers everywhere people actually clock in, including the car park.`
          : 'Click the map to place this location, or fill in the coordinates below.'}
      </p>
    </div>
  )
}
