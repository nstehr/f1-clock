// Circuit GeoJSON loader and coordinate conversion
const fs = require('fs');
const path = require('path');

// Cache for loaded circuit data
let circuitsGeoJson = null;

// Mapping from Ergast circuitId to GeoJSON feature name patterns
const CIRCUIT_MAPPING = {
  'albert_park': 'Albert Park',
  'bahrain': 'Bahrain',
  'shanghai': 'Shanghai',
  'baku': 'Baku',
  'catalunya': 'Barcelona',
  'monaco': 'Monaco',
  'villeneuve': 'Gilles-Villeneuve',
  'ricard': 'Paul Ricard',
  'spielberg': 'Red Bull Ring',
  'red_bull_ring': 'Red Bull Ring',
  'silverstone': 'Silverstone',
  'hockenheimring': 'Hockenheim',
  'hungaroring': 'Hungaroring',
  'spa': 'Spa-Francorchamps',
  'monza': 'Monza',
  'marina_bay': 'Marina Bay',
  'suzuka': 'Suzuka',
  'losail': 'Losail',
  'americas': 'Circuit of the Americas',
  'rodriguez': 'Hermanos Rodríguez',
  'interlagos': 'Interlagos',
  'yas_marina': 'Yas Marina',
  'jeddah': 'Jeddah',
  'miami': 'Miami',
  'vegas': 'Las Vegas',
  'zandvoort': 'Zandvoort',
  'imola': 'Enzo e Dino Ferrari',
  'portimao': 'Algarve',
  'mugello': 'Mugello',
  'nurburgring': 'Nürburgring',
  'istanbul': 'Istanbul',
  'sochi': 'Sochi',
  'sepang': 'Sepang',
  'magny_cours': 'Magny-Cours',
  'indianapolis': 'Indianapolis',
  'kyalami': 'Kyalami',
  'estoril': 'Estoril',
  'galvez': 'Gálvez',
  'jacarepagua': 'Nelson Piquet',
  // Circuits not in GeoJSON (will fail gracefully):
  // yeongam (Korea), buddh (India), valencia, fuji, adelaide, jerez, aida, donington
};

async function loadCircuitsGeoJson() {
  if (circuitsGeoJson) return circuitsGeoJson;

  // Try local cache first
  const cachePath = path.join(__dirname, 'circuits-cache.json');
  if (fs.existsSync(cachePath)) {
    circuitsGeoJson = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return circuitsGeoJson;
  }

  // Fetch from GitHub
  console.log('Fetching circuits GeoJSON from GitHub...');
  const res = await fetch('https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson');
  if (!res.ok) throw new Error(`Failed to fetch circuits: ${res.status}`);
  circuitsGeoJson = await res.json();

  // Cache locally
  fs.writeFileSync(cachePath, JSON.stringify(circuitsGeoJson, null, 2));
  console.log('Cached circuits GeoJSON locally');

  return circuitsGeoJson;
}

function findCircuit(circuitId) {
  if (!circuitsGeoJson) throw new Error('Circuits not loaded');

  const searchName = CIRCUIT_MAPPING[circuitId];
  if (!searchName) {
    console.warn(`No mapping for circuit: ${circuitId}`);
    return null;
  }

  // Find matching feature
  const feature = circuitsGeoJson.features.find(f => {
    const name = f.properties?.Name || '';
    return name.toLowerCase().includes(searchName.toLowerCase());
  });

  if (!feature) {
    console.warn(`Circuit not found in GeoJSON: ${circuitId} (searched for ${searchName})`);
    return null;
  }

  return feature;
}

// Convert lat/lon coordinates to local x/y meters
function convertToLocalCoords(coordinates) {
  if (!coordinates || !coordinates.length) return [];

  // Find centroid
  let sumLat = 0, sumLon = 0;
  for (const [lon, lat] of coordinates) {
    sumLat += lat;
    sumLon += lon;
  }
  const centerLat = sumLat / coordinates.length;
  const centerLon = sumLon / coordinates.length;

  // Convert to meters from centroid using equirectangular approximation
  const latToM = 111320; // meters per degree latitude
  const lonToM = 111320 * Math.cos(centerLat * Math.PI / 180); // meters per degree longitude

  return coordinates.map(([lon, lat]) => ({
    x: (lon - centerLon) * lonToM,
    y: (lat - centerLat) * latToM,
  }));
}

function getTrackOutline(circuitId) {
  const feature = findCircuit(circuitId);
  if (!feature) return null;

  const geom = feature.geometry;
  let coords;

  if (geom.type === 'LineString') {
    coords = geom.coordinates;
  } else if (geom.type === 'MultiLineString') {
    // Take the longest line (main track)
    coords = geom.coordinates.reduce((a, b) => a.length > b.length ? a : b);
  } else if (geom.type === 'Polygon') {
    coords = geom.coordinates[0]; // outer ring
  } else {
    console.warn(`Unsupported geometry type: ${geom.type}`);
    return null;
  }

  return convertToLocalCoords(coords);
}

// Parameterize track as distance along path (0 to 1)
function parameterizeTrack(outline) {
  if (!outline || outline.length < 2) return null;

  const segments = [];
  let totalDist = 0;

  for (let i = 1; i < outline.length; i++) {
    const dx = outline[i].x - outline[i - 1].x;
    const dy = outline[i].y - outline[i - 1].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    segments.push({ startIdx: i - 1, dist, cumDist: totalDist });
    totalDist += dist;
  }

  // Close the loop (start/finish)
  const dx = outline[0].x - outline[outline.length - 1].x;
  const dy = outline[0].y - outline[outline.length - 1].y;
  const closingDist = Math.sqrt(dx * dx + dy * dy);
  segments.push({ startIdx: outline.length - 1, dist: closingDist, cumDist: totalDist });
  totalDist += closingDist;

  return { outline, segments, totalDist };
}

// Get x,y position at track progress (0 to 1)
function getPositionAtProgress(trackParam, progress) {
  if (!trackParam) return { x: 0, y: 0 };

  // Normalize progress to 0-1
  progress = progress - Math.floor(progress);
  const targetDist = progress * trackParam.totalDist;

  // Find segment
  let seg = trackParam.segments[0];
  for (const s of trackParam.segments) {
    if (s.cumDist + s.dist >= targetDist) {
      seg = s;
      break;
    }
  }

  // Interpolate within segment
  const segProgress = seg.dist > 0 ? (targetDist - seg.cumDist) / seg.dist : 0;
  const p1 = trackParam.outline[seg.startIdx];
  const p2Idx = (seg.startIdx + 1) % trackParam.outline.length;
  const p2 = trackParam.outline[p2Idx];

  return {
    x: p1.x + (p2.x - p1.x) * segProgress,
    y: p1.y + (p2.y - p1.y) * segProgress,
  };
}

module.exports = {
  loadCircuitsGeoJson,
  getTrackOutline,
  parameterizeTrack,
  getPositionAtProgress,
  CIRCUIT_MAPPING,
};
