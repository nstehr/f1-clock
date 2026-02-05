// Max playback window: 3300s (55 min), leaving 5 min for the podium display
const MAX_RACE_DURATION_S = 3300;
// Reference GP duration: 90 minutes. Shorter races (sprints) get proportionally shorter playback.
const REFERENCE_RACE_MS = 5400000;

// Phase 1: Determine time bounds from lap data (actual race start to finish).
// Falls back to position data if lap data is insufficient.
function initRaceContext(positionData, drivers, lapsData, raceControlData, stintsData, session) {
  let raceStart = null, raceEnd = null;

  // Collect all laps with timestamps, sorted
  const allLaps = lapsData
    .filter(l => l.date_start)
    .map(l => ({ t: new Date(l.date_start).getTime(), lap: l.lap_number, dn: l.driver_number }))
    .sort((a, b) => a.t - b.t);

  if (allLaps.length >= 2) {
    // Race starts at lap 1 (or the earliest lap)
    raceStart = allLaps[0].t;

    // Find the last lap start and estimate race end by adding an average lap duration
    const lastLap = allLaps[allLaps.length - 1];

    // Compute average lap duration from consecutive laps of any driver
    const lapsByDriver = {};
    for (const l of allLaps) {
      if (!lapsByDriver[l.dn]) lapsByDriver[l.dn] = [];
      lapsByDriver[l.dn].push(l);
    }
    let totalDur = 0, durCount = 0;
    for (const laps of Object.values(lapsByDriver)) {
      for (let i = 1; i < laps.length; i++) {
        const d = laps[i].t - laps[i - 1].t;
        if (d > 0 && d < 300000) { // sanity: < 5 min per lap
          totalDur += d;
          durCount++;
        }
      }
    }
    const avgLapDur = durCount > 0 ? totalDur / durCount : 90000; // fallback 90s
    raceEnd = lastLap.t + avgLapDur;
  }

  // Fallback to position data if laps didn't work
  if (!raceStart || !raceEnd) {
    raceStart = Infinity;
    raceEnd = -Infinity;
    for (const p of positionData) {
      if (!p.date) continue;
      const t = new Date(p.date).getTime();
      if (t < raceStart) raceStart = t;
      if (t > raceEnd) raceEnd = t;
    }
    if (raceStart === Infinity) throw new Error('No timing data available');
  }

  const raceDurationMs = raceEnd - raceStart;
  const isSprint = session.session_name === 'Sprint';
  const baseEffective = Math.round((raceDurationMs / REFERENCE_RACE_MS) * MAX_RACE_DURATION_S);
  const effectiveRaceDurationS = Math.min(MAX_RACE_DURATION_S, isSprint ? Math.round(baseEffective * 0.7) : baseEffective);

  return { raceStart, raceEnd, effectiveRaceDurationS, positionData, drivers, lapsData, raceControlData, stintsData, session };
}

// Update time bounds with another driver's data
function expandTimeBounds(ctx, locationData) {
  for (const d of locationData) {
    if (d.x === 0 && d.y === 0) continue;
    const t = new Date(d.date).getTime();
    if (t < ctx.raceStart) ctx.raceStart = t;
    if (t > ctx.raceEnd) ctx.raceEnd = t;
  }
}

// Phase 2: Normalize one driver's location data into downsampled points.
function normalizeDriverLocations(rawData, raceStart, raceDuration, effectiveRaceDurationS) {
  const points = [];
  for (const d of rawData) {
    if (d.x === 0 && d.y === 0) continue;
    const t = ((new Date(d.date).getTime() - raceStart) / raceDuration) * effectiveRaceDurationS;
    points.push({ t, x: d.x, y: d.y });
  }
  points.sort((a, b) => a.t - b.t);

  if (!points.length) return [];

  // Downsample to ~1 point per second
  const sampled = [points[0]];
  let lastT = points[0].t;
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - lastT >= 1) {
      sampled.push(points[i]);
      lastT = points[i].t;
    }
  }
  return sampled;
}

// Phase 3: Build track outline from one driver's raw data using lap boundaries.
function buildTrackOutline(outlineDriverRawData, lapsData, outlineDriverNum, raceStart, raceDuration, driverLocations, effectiveRaceDurationS) {
  const lapsByDriver = {};
  for (const lap of lapsData) {
    const dn = lap.driver_number;
    if (!lapsByDriver[dn]) lapsByDriver[dn] = [];
    lapsByDriver[dn].push(lap);
  }
  for (const dn of Object.keys(lapsByDriver)) {
    lapsByDriver[dn].sort((a, b) => a.lap_number - b.lap_number);
  }

  const outlineDriver = String(outlineDriverNum);
  const outlineLaps = lapsByDriver[outlineDriver] || lapsByDriver[Object.keys(lapsByDriver)[0]] || [];

  // Find lap 2→3 boundary
  let lapStartRaw = null, lapEndRaw = null;
  for (const lap of outlineLaps) {
    if (lap.lap_number === 2 && lap.date_start) lapStartRaw = new Date(lap.date_start).getTime();
    if (lap.lap_number === 3 && lap.date_start) lapEndRaw = new Date(lap.date_start).getTime();
  }
  if (!lapStartRaw || !lapEndRaw) {
    for (let i = 0; i < outlineLaps.length - 1; i++) {
      if (outlineLaps[i].date_start && outlineLaps[i + 1].date_start && outlineLaps[i].lap_number >= 2) {
        lapStartRaw = new Date(outlineLaps[i].date_start).getTime();
        lapEndRaw = new Date(outlineLaps[i + 1].date_start).getTime();
        break;
      }
    }
  }

  let trackOutline = [];
  if (lapStartRaw && lapEndRaw) {
    const rawPoints = outlineDriverRawData
      .filter(d => (d.x !== 0 || d.y !== 0))
      .map(d => ({ rawT: new Date(d.date).getTime(), x: d.x, y: d.y }))
      .filter(d => d.rawT >= lapStartRaw && d.rawT <= lapEndRaw)
      .sort((a, b) => a.rawT - b.rawT);

    if (rawPoints.length > 0) {
      trackOutline = [{ x: rawPoints[0].x, y: rawPoints[0].y }];
      for (let i = 1; i < rawPoints.length; i++) {
        const prev = trackOutline[trackOutline.length - 1];
        const dx = rawPoints[i].x - prev.x;
        const dy = rawPoints[i].y - prev.y;
        if (Math.sqrt(dx * dx + dy * dy) > 20) {
          trackOutline.push({ x: rawPoints[i].x, y: rawPoints[i].y });
        }
      }
    }
  }

  // Fallback
  if (trackOutline.length < 20) {
    const bestDriver = Object.keys(driverLocations).reduce((a, b) =>
      driverLocations[a].length > driverLocations[b].length ? a : b
    );
    const pts = driverLocations[bestDriver];
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) { start = i; break; }
    }
    trackOutline = pts.slice(start, start + 300).map(p => ({ x: p.x, y: p.y }));
  }

  // Total laps + leader lap times
  let totalLaps = 0;
  for (const dn of Object.keys(lapsByDriver)) {
    const maxLap = lapsByDriver[dn].reduce((m, l) => Math.max(m, l.lap_number), 0);
    totalLaps = Math.max(totalLaps, maxLap);
  }

  const leaderLaps = outlineLaps.map(l => {
    if (!l.date_start) return null;
    const t = ((new Date(l.date_start).getTime() - raceStart) / raceDuration) * effectiveRaceDurationS;
    return { t, lap: l.lap_number };
  }).filter(Boolean);

  // Extract sector boundaries from lap 2 sector durations
  let trackSectors = null;
  const lap2 = outlineLaps.find(l => l.lap_number === 2);
  if (lap2 && lap2.duration_sector_1 && lap2.duration_sector_2 && lap2.duration_sector_3 && trackOutline.length >= 10) {
    const s1 = lap2.duration_sector_1;
    const s2 = lap2.duration_sector_2;
    const s3 = lap2.duration_sector_3;
    const total = s1 + s2 + s3;

    // Calculate where each sector ends as a fraction of the lap
    const s1EndRatio = s1 / total;
    const s2EndRatio = (s1 + s2) / total;

    // Convert to track outline indices
    const n = trackOutline.length;
    const idx1 = Math.floor(n * s1EndRatio);
    const idx2 = Math.floor(n * s2EndRatio);

    // Ensure minimum segment sizes (at least 3 points each)
    const minPts = 3;
    const safeIdx1 = Math.max(minPts, Math.min(idx1, n - 2 * minPts));
    const safeIdx2 = Math.max(safeIdx1 + minPts, Math.min(idx2, n - minPts));

    trackSectors = {
      sector1: trackOutline.slice(0, safeIdx1 + 1),
      sector2: trackOutline.slice(safeIdx1, safeIdx2 + 1),
      sector3: trackOutline.slice(safeIdx2)
    };
  }

  return { trackOutline, trackSectors, totalLaps, leaderLaps };
}

// Phase 4: Finalize — build positions, events, metadata.
function finalizeRaceData(ctx, driverLocations, trackOutline, trackSectors, totalLaps, leaderLaps) {
  const { raceStart, raceEnd, effectiveRaceDurationS, positionData, drivers, raceControlData, stintsData, session } = ctx;
  const raceDuration = raceEnd - raceStart;

  const driverMap = {};
  for (const d of drivers) {
    driverMap[d.driver_number] = {
      number: d.driver_number,
      code: d.name_acronym || d.last_name?.substring(0, 3).toUpperCase() || String(d.driver_number),
      name: d.full_name || `${d.first_name || ''} ${d.last_name || ''}`.trim(),
      team: d.team_name || 'Unknown',
      color: d.team_colour ? `#${d.team_colour}` : '#ffffff',
    };
  }

  const events = [];
  if (raceControlData) {
    for (const e of raceControlData) {
      if (!e.date) continue;
      const t = ((new Date(e.date).getTime() - raceStart) / raceDuration) * effectiveRaceDurationS;
      if (t < 0 || t > effectiveRaceDurationS) continue;
      if (e.category === 'Flag' || e.category === 'SafetyCar') {
        events.push({ t, category: e.category, flag: e.flag || null, message: e.message || '', lap: e.lap_number || null });
      }
    }
    events.sort((a, b) => a.t - b.t);
  }

  // Pit stops per driver (from is_pit_out_lap)
  const pitStops = {};
  let fastestLap = null;
  for (const lap of ctx.lapsData) {
    const dn = lap.driver_number;
    if (lap.is_pit_out_lap && lap.date_start) {
      const t = ((new Date(lap.date_start).getTime() - raceStart) / raceDuration) * effectiveRaceDurationS;
      if (t >= 0 && t <= effectiveRaceDurationS) {
        if (!pitStops[dn]) pitStops[dn] = [];
        pitStops[dn].push({ t, lap: lap.lap_number });
      }
    }
    // Fastest lap: exclude pit out laps and lap 1
    if (lap.lap_duration && lap.lap_number > 1 && !lap.is_pit_out_lap) {
      if (!fastestLap || lap.lap_duration < fastestLap.duration) {
        const t = lap.date_start ? ((new Date(lap.date_start).getTime() - raceStart) / raceDuration) * effectiveRaceDurationS : 0;
        fastestLap = { driverNumber: dn, lap: lap.lap_number, duration: lap.lap_duration, t };
      }
    }
  }

  const driverPositions = {};
  for (const p of positionData) {
    const dn = p.driver_number;
    if (!driverPositions[dn]) driverPositions[dn] = [];
    const t = ((new Date(p.date).getTime() - raceStart) / raceDuration) * effectiveRaceDurationS;
    if (t >= 0 && t <= effectiveRaceDurationS) {
      driverPositions[dn].push({ t, position: p.position });
    }
  }
  for (const dn of Object.keys(driverPositions)) {
    driverPositions[dn].sort((a, b) => a.t - b.t);
  }

  // Process stint data (tire compounds per driver)
  const stints = {};
  if (stintsData && stintsData.length) {
    for (const s of stintsData) {
      const dn = s.driver_number;
      if (!stints[dn]) stints[dn] = [];
      stints[dn].push({
        lapStart: s.lap_start,
        lapEnd: s.lap_end,
        compound: s.compound,
      });
    }
    // Sort by lap start
    for (const dn of Object.keys(stints)) {
      stints[dn].sort((a, b) => a.lapStart - b.lapStart);
    }
  }

  const year = session.year || new Date(session.date_start).getFullYear();
  const name = session.circuit_short_name || session.country_name || 'Unknown';
  const suffix = session.session_name === 'Sprint' ? 'Sprint' : 'GP';

  return {
    title: `${year} ${name} ${suffix}`,
    raceDate: session.date_start ? session.date_start.substring(0, 10) : null,
    circuitName: session.circuit_short_name || null,
    trackOutline,
    trackSectors,
    drivers: driverMap,
    locations: driverLocations,
    positions: driverPositions,
    totalLaps,
    laps: leaderLaps,
    events,
    pitStops,
    fastestLap,
    stints,
    raceDurationS: effectiveRaceDurationS,
  };
}

module.exports = { initRaceContext, expandTimeBounds, normalizeDriverLocations, buildTrackOutline, finalizeRaceData };
