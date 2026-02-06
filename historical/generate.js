// Orchestrates fetching and interpolation to generate race data
const { getRaceResults, getLaps, getPitStops } = require('./ergast');
const { loadCircuitsGeoJson, getTrackOutline, parameterizeTrack } = require('./circuits');
const { buildDriverTimelines, interpolateLocations, buildPositionTimeline, parseLapTime } = require('./interpolate');

// Extract lat/lon from Ergast circuit data
function getCircuitCoordsFromErgast(circuit) {
  if (circuit.Location?.lat && circuit.Location?.long) {
    return {
      lat: parseFloat(circuit.Location.lat),
      lon: parseFloat(circuit.Location.long),
    };
  }
  return null;
}

// Max playback duration (match main app)
const MAX_RACE_DURATION_S = 3300;
const REFERENCE_RACE_MS = 5400000; // 90 min reference

async function generateRace(year, round) {
  console.log(`Generating ${year} round ${round}...`);

  // Load circuit data
  await loadCircuitsGeoJson();

  // Fetch race data from Ergast
  console.log('  Fetching race results...');
  const raceInfo = await getRaceResults(year, round);
  if (!raceInfo) {
    throw new Error(`Race not found: ${year} round ${round}`);
  }

  const circuitId = raceInfo.Circuit.circuitId;
  const raceName = raceInfo.raceName;
  const raceDate = raceInfo.date;
  const results = raceInfo.Results;

  console.log(`  Race: ${raceName} at ${circuitId}`);
  console.log(`  Date: ${raceDate}`);
  console.log(`  Drivers: ${results.length}`);

  // Get track outline
  console.log('  Loading track outline...');
  const trackOutline = getTrackOutline(circuitId);
  if (!trackOutline) {
    throw new Error(`No track data for circuit: ${circuitId}`);
  }
  console.log(`  Track points: ${trackOutline.length}`);

  const trackParam = parameterizeTrack(trackOutline);

  // Fetch lap data
  console.log('  Fetching lap data...');
  const laps = await getLaps(year, round);
  console.log(`  Laps fetched: ${laps.length}`);

  if (!laps.length) {
    throw new Error('No lap data available for this race');
  }

  // Fetch pit stops (2012+)
  console.log('  Fetching pit stops...');
  const pitStops = await getPitStops(year, round);
  console.log(`  Pit stops: ${pitStops.length}`);

  // Build driver timelines
  console.log('  Building driver timelines...');
  const timelines = buildDriverTimelines(laps, results);

  // Determine race duration and effective playback duration
  const totalLaps = Math.max(...Object.values(timelines).map(t => t.laps.length));
  const winnerTime = Math.min(...Object.values(timelines).filter(t => t.laps.length === totalLaps).map(t => t.totalTime));
  const realDurationMs = winnerTime * 1000;
  const effectiveRaceDurationS = Math.min(MAX_RACE_DURATION_S, Math.round((realDurationMs / REFERENCE_RACE_MS) * MAX_RACE_DURATION_S));
  const timeScale = effectiveRaceDurationS / winnerTime;

  console.log(`  Total laps: ${totalLaps}`);
  console.log(`  Winner time: ${Math.floor(winnerTime / 60)}m ${Math.floor(winnerTime % 60)}s`);
  console.log(`  Playback duration: ${effectiveRaceDurationS}s (${timeScale.toFixed(2)}x compression)`);

  // Generate interpolated locations for each driver
  console.log('  Interpolating locations...');
  const driverLocations = {};
  const driverPositions = {};
  const driverMap = {};

  for (const [driverId, timeline] of Object.entries(timelines)) {
    // Generate locations at 1-second intervals in real time, then scale
    const rawLocations = interpolateLocations(timeline, trackParam, winnerTime + 60, 1);

    // Scale time and downsample to ~1 location per second
    const scaledLocations = [];
    let lastT = -1;
    for (const loc of rawLocations) {
      const scaledT = loc.t * timeScale;
      if (scaledT - lastT >= 1 || lastT < 0) {
        scaledLocations.push({ t: scaledT, x: loc.x, y: loc.y });
        lastT = scaledT;
      }
    }
    driverLocations[timeline.number] = scaledLocations;

    // Build position timeline (scaled)
    driverPositions[timeline.number] = buildPositionTimeline(timeline)
      .map(p => ({ t: p.t * timeScale, position: p.position }));

    // Driver info
    driverMap[timeline.number] = {
      number: parseInt(timeline.number, 10),
      code: timeline.code,
      name: timeline.name,
      team: timeline.team,
      color: timeline.color,
    };
  }

  // Build leader lap times
  const leader = Object.values(timelines).find(t => t.finishPosition === 1);
  const leaderLaps = leader ? leader.laps.map(l => ({
    t: l.endTime * timeScale,
    lap: l.lap,
  })) : [];

  // Build pit stops per driver
  const pitStopsMap = {};
  for (const ps of pitStops) {
    const driverId = ps.driverId;
    const timeline = Object.values(timelines).find(t => t.driverId === driverId);
    if (!timeline) continue;

    const driverNum = timeline.number;
    if (!pitStopsMap[driverNum]) pitStopsMap[driverNum] = [];

    // Find the lap this pit stop occurred on
    const lap = parseInt(ps.lap, 10);
    const lapData = timeline.laps.find(l => l.lap === lap);
    const t = lapData ? lapData.endTime * timeScale : 0;

    pitStopsMap[driverNum].push({ t, lap });
  }

  // Find fastest lap
  let fastestLap = null;
  for (const timeline of Object.values(timelines)) {
    for (const lap of timeline.laps) {
      if (lap.lap === 1) continue; // Exclude lap 1
      if (!fastestLap || lap.time < fastestLap.duration) {
        fastestLap = {
          driverNumber: parseInt(timeline.number, 10),
          lap: lap.lap,
          duration: lap.time,
          t: lap.endTime * timeScale,
        };
      }
    }
  }

  // Get circuit coordinates for weather display
  const circuitCoords = getCircuitCoordsFromErgast(raceInfo.Circuit);

  // Build final race data
  const raceData = {
    title: `${year} ${raceName.replace(' Grand Prix', ' GP')}`,
    raceDate,
    circuitName: raceInfo.Circuit.circuitName,
    circuitCoords,
    trackOutline,
    trackSectors: null, // Not available historically
    drivers: driverMap,
    locations: driverLocations,
    positions: driverPositions,
    totalLaps,
    laps: leaderLaps,
    events: [], // Limited historical data
    pitStops: pitStopsMap,
    fastestLap,
    stints: {}, // No tire data pre-2018
    raceDurationS: effectiveRaceDurationS,
  };

  console.log(`  Generated: ${raceData.title}`);
  return raceData;
}

module.exports = { generateRace };
