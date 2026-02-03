let raceData = null;
const canvas = document.getElementById('track');
const ctx = canvas.getContext('2d');
const leaderboardEl = document.getElementById('leaderboard');
const titleEl = document.getElementById('race-title');
const wallClockEl = document.getElementById('wall-clock');
const lapEl = document.getElementById('race-lap');
const bannerEl = document.getElementById('event-banner');
const progressFillEl = document.getElementById('progress-fill');

let transform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
let lastShownEventIdx = -1;
let bannerTimeout = null;
let podiumAlpha = 0;
let raceFinished = false;
let finishAnimT = 0;

// Sector colors - muted dark palette
const SECTOR_COLORS = {
  sector1: '#4a3d5c',  // Muted purple
  sector2: '#3d4a5c',  // Muted blue
  sector3: '#3d5c4a',  // Muted green
};

// Tire compound colors
const TIRE_COLORS = {
  SOFT: '#ff3333',
  MEDIUM: '#ffdd00',
  HARD: '#ffffff',
  INTERMEDIATE: '#44bb44',
  WET: '#4488ff',
};

// Fastest lap highlight tracking
let fastestLapShownAt = -1;
let lastLoadedHour = new Date().getHours();

// Weather elements
const localTempEl = document.querySelector('#weather-local .weather-temp');
const localCondEl = document.querySelector('#weather-local .weather-cond');
const raceTempEl = document.querySelector('#weather-race .weather-temp');
const raceCondEl = document.querySelector('#weather-race .weather-cond');

async function loadRace() {
  const res = await fetch('/api/race');
  if (!res.ok) {
    setTimeout(loadRace, 2000);
    return;
  }
  raceData = await res.json();
  titleEl.textContent = raceData.title;
  lastShownEventIdx = -1;
  fastestLapShownAt = -1;
  lastLoadedHour = new Date().getHours();
  inferredStartPositions = findInferredStartPositions();
  computeTransform();
  loadRaceWeather();
}

// --- Weather ---
async function loadLocalWeather() {
  // First try configured city
  try {
    const res = await fetch('/api/weather/local');
    if (res.ok) {
      const data = await res.json();
      localTempEl.textContent = `${data.temp}C`;
      localCondEl.textContent = data.condition;
      return;
    }
  } catch {}

  // Fall back to browser geolocation
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const res = await fetch(`/api/weather/current?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
      if (!res.ok) return;
      const data = await res.json();
      localTempEl.textContent = `${data.temp}C`;
      localCondEl.textContent = data.condition;
    } catch {}
  }, () => {});
}

async function loadRaceWeather() {
  try {
    const res = await fetch('/api/weather/race');
    if (!res.ok) return;
    const data = await res.json();
    raceTempEl.textContent = `${data.tempHigh}/${data.tempLow}C`;
    raceCondEl.textContent = data.condition;
  } catch {}
}

function computeTransform() {
  if (!raceData) return;
  const pts = raceData.trackOutline;
  if (!pts.length) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const pad = 40;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  const scale = Math.min(w / rangeX, h / rangeY);

  transform = {
    scaleX: scale,
    scaleY: scale,
    offsetX: pad + (w - rangeX * scale) / 2 - minX * scale,
    offsetY: pad + (h - rangeY * scale) / 2 + maxY * scale,
  };
}

function toScreen(x, y) {
  return {
    sx: x * transform.scaleX + transform.offsetX,
    sy: -y * transform.scaleY + transform.offsetY,
  };
}

function resizeCanvas() {
  const panel = document.getElementById('track-panel');
  canvas.width = panel.clientWidth - 32;
  canvas.height = panel.clientHeight - 32;
  if (raceData) computeTransform();
}

function isDriverRetired(driverNum, t) {
  const locs = raceData.locations[driverNum];
  if (!locs || !locs.length) return true;

  const lastT = locs[locs.length - 1].t;

  // If current time is 30+ seconds past their last data point, they've retired
  // But not if they finished (last point near end of race)
  if (t > lastT + 30 && lastT < 3200) return true;

  // Check if driver is stationary (stuck at same position for 60+ seconds)
  // This catches drivers who stopped but still have telemetry data
  // Only check during the race, not in the final minutes when cars slow down after finish
  if (t > 60 && t < 3200) {
    // Find position at current time
    const currentPos = getDriverPos(driverNum, t);
    // Find position 60 seconds ago
    const pastPos = getDriverPos(driverNum, t - 60);
    if (currentPos && pastPos) {
      const dx = currentPos.x - pastPos.x;
      const dy = currentPos.y - pastPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // If moved less than 50 units in 60 seconds, consider them stopped
      // (normal racing would cover hundreds/thousands of units per second)
      if (dist < 50) return true;
    }
  }

  return false;
}

function getDriverPos(driverNum, t) {
  const locs = raceData.locations[driverNum];
  if (!locs || !locs.length) return null;
  if (t <= locs[0].t) return { x: locs[0].x, y: locs[0].y };
  if (t >= locs[locs.length - 1].t) return { x: locs[locs.length - 1].x, y: locs[locs.length - 1].y };

  let lo = 0, hi = locs.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (locs[mid].t <= t) lo = mid; else hi = mid;
  }

  const a = locs[lo], b = locs[hi];
  const frac = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}

// Cache for drivers with inferred starting positions (held constant position from race start)
let inferredStartPositions = {};

function findInferredStartPositions() {
  if (!raceData) return {};

  const inferred = {};

  // Collect all positions that appear at t=0 (or very early in race)
  const earlyPositions = new Set();
  for (const dn of Object.keys(raceData.positions)) {
    const poss = raceData.positions[dn];
    if (poss && poss.length && poss[0].t < 100) {
      earlyPositions.add(poss[0].position);
    }
  }

  // For each driver, check if they need an inferred starting position
  for (const dn of Object.keys(raceData.drivers)) {
    const poss = raceData.positions[dn];
    const locs = raceData.locations[dn];

    // Skip drivers without location data
    if (!locs || locs.length < 100) continue;

    if (!poss || !poss.length) {
      // Driver has no position data at all - find lowest missing position
      for (let p = 1; p <= 20; p++) {
        if (!earlyPositions.has(p)) {
          inferred[dn] = p;
          earlyPositions.add(p); // Mark as taken
          break;
        }
      }
    } else if (poss[0].t > 100) {
      // Driver's first position entry is late - they held a constant position before that
      // Their starting position was likely one above their first recorded position
      const firstRecordedPos = poss[0].position;
      for (let p = 1; p < firstRecordedPos; p++) {
        if (!earlyPositions.has(p)) {
          inferred[dn] = p;
          earlyPositions.add(p); // Mark as taken
          break;
        }
      }
    }
  }

  return inferred;
}

function getDriverRacePos(driverNum, t) {
  const poss = raceData.positions[driverNum];

  // Check if this driver has an inferred starting position
  const inferredPos = inferredStartPositions[driverNum];
  if (inferredPos !== undefined) {
    // Use inferred position until their first recorded position change
    if (!poss || !poss.length) return inferredPos;
    if (t < poss[0].t) return inferredPos;
  }

  if (!poss || !poss.length) return 99;
  let best = poss[0];
  for (const p of poss) {
    if (p.t <= t) best = p; else break;
  }
  return best.position;
}

function getCurrentLap(t) {
  if (!raceData.laps || !raceData.laps.length) return 0;
  let lap = 0;
  for (const l of raceData.laps) {
    if (l.t <= t) lap = l.lap; else break;
  }
  return lap;
}

function getDriverTireCompound(driverNum, lap) {
  const stints = raceData.stints && raceData.stints[driverNum];
  if (!stints || !stints.length) return null;
  for (const stint of stints) {
    if (lap >= stint.lapStart && lap <= stint.lapEnd) {
      return stint.compound;
    }
  }
  // If lap is beyond last stint, use last known compound
  const lastStint = stints[stints.length - 1];
  if (lap > lastStint.lapEnd) return lastStint.compound;
  return null;
}

function formatWallClock() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const h12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ampm}`;
}

function drawChequeredFlag(alpha) {
  const w = canvas.width;
  const h = canvas.height;
  const sqSize = Math.max(20, Math.min(40, w / 16));
  const cols = Math.ceil(w / sqSize);
  const rows = Math.ceil(h / sqSize);

  ctx.save();
  ctx.globalAlpha = alpha;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(c * sqSize, r * sqSize, sqSize, sqSize);
    }
  }

  // "FINISH" text in center
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  ctx.fillRect(w / 2 - 120, h / 2 - 20, 240, 40);
  ctx.fillStyle = '#fff';
  ctx.font = '18px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FINISH', w / 2, h / 2);

  ctx.restore();
}

function getRaceEndTime() {
  if (!raceData || !raceData.locations) return 3600;
  let maxT = 0;
  for (const dn of Object.keys(raceData.locations)) {
    const locs = raceData.locations[dn];
    if (locs && locs.length) {
      const last = locs[locs.length - 1].t;
      if (last > maxT) maxT = last;
    }
  }
  return maxT;
}

function getTopDrivers(t) {
  const driverNums = Object.keys(raceData.drivers);
  const results = [];
  for (const dn of driverNums) {
    const pos = getDriverRacePos(dn, t);
    results.push({ dn, position: pos, info: raceData.drivers[dn] });
  }
  results.sort((a, b) => a.position - b.position);
  return results.slice(0, 3);
}

function drawPodium(alpha) {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const raceEndT = getRaceEndTime();
  const top3 = getTopDrivers(raceEndT);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  // Title
  ctx.fillStyle = '#fff';
  ctx.font = '14px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(raceData.title, cx, h * 0.12);

  ctx.font = '10px "Press Start 2P", monospace';
  ctx.fillStyle = '#888';
  ctx.fillText('RACE RESULTS', cx, h * 0.12 + 24);

  // Podium dimensions
  const blockW = Math.min(120, w * 0.18);
  const gap = Math.min(12, w * 0.015);
  const totalW = blockW * 3 + gap * 2;
  const baseX = cx - totalW / 2;
  const baseY = h * 0.72;

  // Heights: P1 tallest (center), P2 medium (left), P3 short (right)
  const heights = { 1: h * 0.28, 2: h * 0.20, 3: h * 0.14 };
  // Order on podium: P2, P1, P3
  const podiumOrder = [
    { pos: 2, x: baseX },
    { pos: 1, x: baseX + blockW + gap },
    { pos: 3, x: baseX + (blockW + gap) * 2 },
  ];

  for (const slot of podiumOrder) {
    const driver = top3.find(d => d.position === slot.pos);
    if (!driver) continue;

    const bh = heights[slot.pos];
    const bx = slot.x;
    const by = baseY - bh;

    // Block fill with team color
    ctx.fillStyle = driver.info.color;
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillRect(bx, by, blockW, bh);
    ctx.globalAlpha = alpha;

    // Block border
    ctx.strokeStyle = driver.info.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, blockW, bh);

    // Position number
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.min(36, blockW * 0.35)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(slot.pos), bx + blockW / 2, by + bh * 0.4);

    // Driver code
    ctx.font = `${Math.min(14, blockW * 0.12)}px "Press Start 2P", monospace`;
    ctx.fillStyle = driver.info.color;
    ctx.fillText(driver.info.code, bx + blockW / 2, by + bh * 0.6);

    // Driver name (below block)
    ctx.font = `${Math.min(8, blockW * 0.07)}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#aaa';
    ctx.fillText(driver.info.name, bx + blockW / 2, baseY + 20);

    // Team name
    ctx.fillStyle = '#666';
    ctx.fillText(driver.info.team, bx + blockW / 2, baseY + 36);
  }

  // Base line
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(baseX - 10, baseY);
  ctx.lineTo(baseX + totalW + 10, baseY);
  ctx.stroke();

  ctx.restore();
}

function showEvent(event) {
  let cssClass = 'flag-default';
  if (event.category === 'SafetyCar') {
    cssClass = 'flag-safety';
  } else if (event.flag) {
    const f = event.flag.toUpperCase();
    if (f.includes('RED')) cssClass = 'flag-red';
    else if (f.includes('YELLOW')) cssClass = 'flag-yellow';
    else if (f.includes('GREEN')) cssClass = 'flag-green';
  }

  bannerEl.textContent = event.message;
  bannerEl.className = cssClass;

  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    bannerEl.className = 'hidden';
  }, 5000);
}

function render() {
  if (!raceData) {
    requestAnimationFrame(render);
    return;
  }

  const now = Date.now();
  const t = (now % 3600000) / 1000;

  // Update wall clock (only on change to avoid flicker)
  const clockText = formatWallClock();
  if (wallClockEl.textContent !== clockText) {
    wallClockEl.textContent = clockText;
  }

  // Update lap counter (only on change)
  const currentLap = getCurrentLap(t);
  const lapText = raceFinished ? 'FINISHED' : `LAP ${currentLap} / ${raceData.totalLaps}`;
  if (lapEl.textContent !== lapText) {
    lapEl.textContent = lapText;
  }

  // Update progress bar
  const pct = raceFinished ? 100 : Math.min(100, Math.floor(t / 3300 * 100));
  const pctStr = pct + '%';
  if (progressFillEl.style.width !== pctStr) {
    progressFillEl.style.width = pctStr;
  }

  // Check for events to show
  if (raceData.events && raceData.events.length) {
    // Find the latest event that should have fired by now
    for (let i = 0; i < raceData.events.length; i++) {
      const e = raceData.events[i];
      if (e.t <= t && e.t > t - 3 && i > lastShownEventIdx) {
        showEvent(e);
        lastShownEventIdx = i;
        break;
      }
    }
    // Reset when looping back to start of hour
    if (t < 10 && lastShownEventIdx > 0) {
      lastShownEventIdx = -1;
    }
  }

  // Detect race finish
  const raceEndT = getRaceEndTime();
  const isFinished = currentLap >= raceData.totalLaps && t > raceEndT + 10;

  if (isFinished && !raceFinished) {
    raceFinished = true;
    finishAnimT = 0;
  }
  if (t > 2 && t < 10 && raceFinished) {
    raceFinished = false;
    podiumAlpha = 0;
    finishAnimT = 0;
    loadRace();
  }

  if (raceFinished) {
    finishAnimT++;
    if (finishAnimT > 120) {
      podiumAlpha = Math.min(1, podiumAlpha + 0.02);
    }
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Chequered flag animation (frames 0-120 after finish)
  if (raceFinished && finishAnimT <= 120) {
    const pulse = 0.15 + 0.15 * Math.sin(finishAnimT * 0.15);
    drawChequeredFlag(pulse);
  }

  // Draw podium overlay if race is finished
  if (podiumAlpha >= 1) {
    drawPodium(1);
    requestAnimationFrame(render);
    return;
  }

  if (podiumAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = 1 - podiumAlpha;
  }

  // Draw track outline
  const outline = raceData.trackOutline;
  const sectors = raceData.trackSectors;

  // Helper to draw a sector segment
  const drawSector = (points, color) => {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    const p0 = toScreen(points[0].x, points[0].y);
    ctx.moveTo(p0.sx, p0.sy);
    for (let i = 1; i < points.length; i++) {
      const p = toScreen(points[i].x, points[i].y);
      ctx.lineTo(p.sx, p.sy);
    }
    // Dark border
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 8;
    ctx.stroke();
    // Colored sector
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
  };

  if (sectors && sectors.sector1 && sectors.sector1.length > 1) {
    // Draw each sector with its color
    drawSector(sectors.sector1, SECTOR_COLORS.sector1);
    drawSector(sectors.sector2, SECTOR_COLORS.sector2);
    drawSector(sectors.sector3, SECTOR_COLORS.sector3);
  } else if (outline.length > 1) {
    // Fallback: single-color track
    ctx.beginPath();
    const p0 = toScreen(outline[0].x, outline[0].y);
    ctx.moveTo(p0.sx, p0.sy);
    for (let i = 1; i < outline.length; i++) {
      const p = toScreen(outline[i].x, outline[i].y);
      ctx.lineTo(p.sx, p.sy);
    }
    ctx.closePath();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw start/finish line
  if (outline.length > 2) {
    const p0 = toScreen(outline[0].x, outline[0].y);
    const p1 = toScreen(outline[1].x, outline[1].y);
    // Calculate perpendicular angle
    const dx = p1.sx - p0.sx;
    const dy = p1.sy - p0.sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    const perpX = -dy / len;
    const perpY = dx / len;
    const lineLen = 12;
    // Draw checkered start/finish line
    ctx.beginPath();
    ctx.moveTo(p0.sx - perpX * lineLen, p0.sy - perpY * lineLen);
    ctx.lineTo(p0.sx + perpX * lineLen, p0.sy + perpY * lineLen);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Collect driver states
  const driverNums = Object.keys(raceData.drivers);
  const driverStates = [];

  for (const dn of driverNums) {
    const pos = getDriverPos(dn, t);
    if (!pos) continue;
    const racePos = getDriverRacePos(dn, t);
    const info = raceData.drivers[dn];
    const retired = isDriverRetired(dn, t);
    driverStates.push({ dn, pos, racePos, info, retired });
  }

  // Check if fastest lap was just set (for flash effect)
  const flDriver = raceData.fastestLap ? String(raceData.fastestLap.driverNumber) : null;
  const flTime = raceData.fastestLap ? raceData.fastestLap.t : -1;
  const flFlashActive = flTime > 0 && t >= flTime && t < flTime + 3; // Flash for 3 seconds
  if (flTime > 0 && t >= flTime && fastestLapShownAt < flTime) {
    fastestLapShownAt = flTime;
  }

  // Draw active cars (back of field first, retired cars hidden)
  driverStates.sort((a, b) => b.racePos - a.racePos);
  for (const ds of driverStates) {
    if (ds.retired) continue;
    const sp = toScreen(ds.pos.x, ds.pos.y);

    // Check for fastest lap flash (purple glow)
    const isFlDriver = String(ds.dn) === flDriver && flFlashActive;
    if (isFlDriver) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 10);
      ctx.shadowColor = `rgba(180, 77, 255, ${0.6 + 0.4 * pulse})`;
      ctx.shadowBlur = 15 + 5 * pulse;
    }
    // Glow effect for top 3 drivers
    else if (ds.racePos <= 3) {
      ctx.shadowColor = ds.info.color;
      ctx.shadowBlur = 10;
    }

    ctx.beginPath();
    ctx.arc(sp.sx, sp.sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = ds.info.color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Label top 3 drivers on the track
    if (ds.racePos <= 3) {
      ctx.font = '7px "Press Start 2P", monospace';
      ctx.fillStyle = ds.info.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(ds.info.code, sp.sx + 8, sp.sy - 4);
    }
  }

  if (podiumAlpha > 0) {
    ctx.restore();
    drawPodium(podiumAlpha);
  }

  // Update leaderboard: active drivers sorted by position, then retired at bottom
  const active = driverStates.filter(d => !d.retired).sort((a, b) => a.racePos - b.racePos);
  const retired = driverStates.filter(d => d.retired).sort((a, b) => a.racePos - b.racePos);

  let html = '';
  for (let i = 0; i < active.length; i++) {
    const ds = active[i];
    const displayPos = i + 1; // Use sequential position to avoid duplicates
    // Pit stop count up to current time
    let pitBadge = '';
    const pits = raceData.pitStops && raceData.pitStops[ds.dn];
    if (pits) {
      const count = pits.filter(p => p.t <= t).length;
      if (count > 0) pitBadge = `<span class="lb-pit">P${count}</span>`;
    }
    // Fastest lap badge
    let flBadge = '';
    if (raceData.fastestLap && String(raceData.fastestLap.driverNumber) === String(ds.dn) && raceData.fastestLap.t <= t) {
      flBadge = '<span class="lb-fl">FL</span>';
    }
    // Tire compound indicator
    let tireBadge = '';
    const compound = getDriverTireCompound(ds.dn, currentLap);
    if (compound && TIRE_COLORS[compound]) {
      tireBadge = `<span class="lb-tire" style="background:${TIRE_COLORS[compound]}"></span>`;
    }
    html += `<div class="lb-row">
      <span class="lb-pos">${displayPos}</span>
      <span class="lb-dot" style="background:${ds.info.color}"></span>
      <span class="lb-name">${ds.info.code}</span>
      ${tireBadge}${flBadge}${pitBadge}
    </div>`;
  }
  for (const ds of retired) {
    html += `<div class="lb-row lb-retired">
      <span class="lb-pos">-</span>
      <span class="lb-dot" style="background:${ds.info.color}"></span>
      <span class="lb-name">${ds.info.code}</span>
      <span class="lb-dnf">DNF</span>
    </div>`;
  }
  if (leaderboardEl._lastHtml !== html) {
    leaderboardEl.innerHTML = html;
    leaderboardEl._lastHtml = html;
  }

  requestAnimationFrame(render);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
loadRace();
loadLocalWeather();
// Refresh local weather every 15 minutes
setInterval(loadLocalWeather, 15 * 60 * 1000);
// Reload race when tab becomes visible if hour changed (rAF is throttled in background)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && new Date().getHours() !== lastLoadedHour) {
    raceFinished = false;
    podiumAlpha = 0;
    finishAnimT = 0;
    loadRace();
  }
});
render();
