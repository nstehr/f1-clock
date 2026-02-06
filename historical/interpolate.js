// Core interpolation logic - generate continuous locations from lap data
const { parameterizeTrack, getPositionAtProgress } = require('./circuits');

// Parse lap time string "1:23.456" to seconds
function parseLapTime(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    const [min, sec] = parts;
    return parseInt(min, 10) * 60 + parseFloat(sec);
  }
  return parseFloat(timeStr);
}

// Build driver lap timeline from Ergast data
function buildDriverTimelines(laps, results) {
  const timelines = {};

  // Initialize from results (get driver list and final status)
  for (const result of results) {
    const driverId = result.Driver.driverId;
    timelines[driverId] = {
      driverId,
      number: result.number,
      code: result.Driver.code || result.Driver.familyName.substring(0, 3).toUpperCase(),
      name: `${result.Driver.givenName} ${result.Driver.familyName}`,
      team: result.Constructor.name,
      color: getTeamColor(result.Constructor.constructorId),
      grid: parseInt(result.grid, 10),
      laps: [],
      status: result.status,
      finishPosition: parseInt(result.position, 10),
    };
  }

  // Process lap data
  for (const lap of laps) {
    const lapNum = parseInt(lap.number, 10);
    for (const timing of lap.Timings) {
      const driverId = timing.driverId;
      if (!timelines[driverId]) continue;

      const lapTime = parseLapTime(timing.time);
      if (lapTime === null) continue;

      timelines[driverId].laps.push({
        lap: lapNum,
        time: lapTime,
        position: parseInt(timing.position, 10),
      });
    }
  }

  // Sort laps and compute cumulative times
  for (const driver of Object.values(timelines)) {
    driver.laps.sort((a, b) => a.lap - b.lap);
    let cumTime = 0;
    for (const lap of driver.laps) {
      lap.startTime = cumTime;
      cumTime += lap.time;
      lap.endTime = cumTime;
    }
    driver.totalTime = cumTime;
  }

  return timelines;
}

// Historical team colors (approximate)
function getTeamColor(constructorId) {
  const colors = {
    'ferrari': '#DC0000',
    'mclaren': '#FF8700',
    'mercedes': '#00D2BE',
    'red_bull': '#1E41FF',
    'williams': '#005AFF',
    'alpine': '#0090FF',
    'renault': '#FFF500',
    'aston_martin': '#006F62',
    'alfa': '#900000',
    'alphatauri': '#2B4562',
    'toro_rosso': '#469BFF',
    'haas': '#FFFFFF',
    'sauber': '#9B0000',
    'racing_point': '#F596C8',
    'force_india': '#FF80C7',
    'lotus_f1': '#000000',
    'caterham': '#005030',
    'marussia': '#6E0000',
    'manor': '#6E0000',
    'virgin': '#CC0000',
    'hrt': '#808080',
    'toyota': '#CC0000',
    'honda': '#FFFFFF',
    'bmw_sauber': '#FFFFFF',
    'super_aguri': '#CC0000',
    'spyker': '#FF6600',
    'midland': '#CC0000',
    'jordan': '#EBC94A',
    'minardi': '#191919',
    'jaguar': '#006400',
    'prost': '#0000CC',
    'arrows': '#FF6600',
    'bar': '#FFFFFF',
    'tyrrell': '#00008B',
    'stewart': '#FFFFFF',
    'benetton': '#00FF00',
    'ligier': '#0000FF',
    'footwork': '#FF6600',
    'simtek': '#800080',
    'pacific': '#006400',
    'forti': '#FFFF00',
    'lola': '#008000',
    'brabham': '#006400',
  };
  return colors[constructorId] || '#808080';
}

// Generate location points at regular intervals
function interpolateLocations(timeline, trackParam, raceEndTime, sampleInterval = 1) {
  const locations = [];

  if (!timeline.laps.length) return locations;

  // Estimate formation lap / race start based on first lap time
  // First lap is usually slower, drivers start from grid
  const firstLapTime = timeline.laps[0]?.time || 90;

  // Generate points from t=0 to race end
  for (let t = 0; t <= raceEndTime; t += sampleInterval) {
    // Find which lap this time falls into
    let lap = null;
    let lapProgress = 0;

    for (const l of timeline.laps) {
      if (t >= l.startTime && t < l.endTime) {
        lap = l;
        lapProgress = (t - l.startTime) / l.time;
        break;
      }
    }

    // Before first lap data - assume on grid or formation
    if (t < (timeline.laps[0]?.startTime || 0)) {
      const gridPos = timeline.grid || 20;
      // Stagger grid positions along track (grid is ~200m, spread over ~0.04 of track)
      const gridProgress = 1 - (gridPos * 0.002);
      const pos = getPositionAtProgress(trackParam, gridProgress);
      locations.push({ t, x: pos.x, y: pos.y });
      continue;
    }

    // After last lap - hold final position or mark as retired
    if (!lap) {
      const lastLap = timeline.laps[timeline.laps.length - 1];
      if (lastLap) {
        // Completed race or retired - hold at finish line or last position
        const progress = lastLap.lap;
        const pos = getPositionAtProgress(trackParam, progress);
        locations.push({ t, x: pos.x, y: pos.y });
      }
      continue;
    }

    // Normal racing - interpolate position along track
    const totalProgress = (lap.lap - 1) + lapProgress;
    const pos = getPositionAtProgress(trackParam, totalProgress);
    locations.push({ t, x: pos.x, y: pos.y });
  }

  return locations;
}

// Generate position changes timeline
function buildPositionTimeline(timeline) {
  const positions = [];
  let lastPos = timeline.grid || 20;

  // Start with grid position
  positions.push({ t: 0, position: lastPos });

  // Add position from each lap
  for (const lap of timeline.laps) {
    if (lap.position !== lastPos) {
      positions.push({ t: lap.endTime, position: lap.position });
      lastPos = lap.position;
    }
  }

  return positions;
}

// Add pit stops to timeline (adds delay, pit lane path simplified)
function applyPitStops(locations, pitStops, trackParam) {
  // For now, pit stops are just reflected in lap times (slower lap)
  // A more sophisticated version would route through pit lane
  return locations;
}

module.exports = {
  parseLapTime,
  buildDriverTimelines,
  interpolateLocations,
  buildPositionTimeline,
  applyPitStops,
};
