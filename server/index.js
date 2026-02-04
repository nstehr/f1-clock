const express = require('express');
const path = require('path');
const { getRaceSessions, getDriverLocationData, getDrivers, getPositions, getLaps, getRaceControl, getStints, probeLocationData } = require('./openf1');
const { initRaceContext, normalizeDriverLocations, buildTrackOutline, finalizeRaceData } = require('./normalize');
const cache = require('./cache');
const { getCircuitCoords } = require('./circuits');
const { getCurrentWeather, getHistoricalWeather, geocodeCity } = require('./weather');

const app = express();
const PORT = process.env.PORT || 3000;
const WEATHER_CITY = process.env.WEATHER_CITY || null;

let cachedRace = null;
let sessions = [];

async function ensureSessions() {
  if (sessions.length) return sessions;
  sessions = cache.getSessions();
  if (sessions) {
    console.log(`Loaded ${sessions.length} sessions from cache`);
  } else {
    console.log('Fetching race session list from API...');
    sessions = await getRaceSessions();
    cache.setSessions(sessions);
    console.log(`Fetched and cached ${sessions.length} race sessions`);
  }
  return sessions;
}

async function fetchAndCacheRace(session) {
  const sk = session.session_key;

  // Fetch small metadata first
  const [drivers, positionData, lapsData, raceControlData, stintsData] = await Promise.all([
    getDrivers(sk),
    getPositions(sk),
    getLaps(sk),
    getRaceControl(sk),
    getStints(sk),
  ]);

  const driverNumbers = [...new Set(drivers.map(d => d.driver_number))];
  console.log(`  Processing ${driverNumbers.length} drivers incrementally...`);

  // Pick outline driver (driver with most laps)
  const lapCounts = {};
  for (const lap of lapsData) {
    lapCounts[lap.driver_number] = (lapCounts[lap.driver_number] || 0) + 1;
  }
  const outlineDriverNum = driverNumbers.reduce((a, b) => (lapCounts[a] || 0) >= (lapCounts[b] || 0) ? a : b);

  // Derive time bounds from position data (already in memory, covers all drivers)
  const ctx = initRaceContext(positionData, drivers, lapsData, raceControlData, stintsData, session);
  const raceDuration = ctx.raceEnd - ctx.raceStart;

  const driverLocations = {};
  let outlineDriverRawData = null;

  // Fetch and normalize each driver one at a time
  for (const dn of driverNumbers) {
    console.log(`    Driver ${dn}${dn === outlineDriverNum ? ' (outline)' : ''}...`);
    const raw = await getDriverLocationData(sk, dn);
    driverLocations[dn] = normalizeDriverLocations(raw, ctx.raceStart, raceDuration, ctx.effectiveRaceDurationS);
    if (dn === outlineDriverNum) outlineDriverRawData = raw;
    // raw is GC-eligible after this iteration (except outline driver)
  }

  // Build track outline from the outline driver's raw data
  const { trackOutline, trackSectors, totalLaps, leaderLaps } = buildTrackOutline(
    outlineDriverRawData, lapsData, outlineDriverNum, ctx.raceStart, raceDuration, driverLocations, ctx.effectiveRaceDurationS
  );
  outlineDriverRawData = null; // free memory

  const raceData = finalizeRaceData(ctx, driverLocations, trackOutline, trackSectors, totalLaps, leaderLaps);
  cache.setRace(sk, raceData);
  console.log(`  Done: ${raceData.title}`);
  return raceData;
}

// Pick a random race from the cache, avoiding the current one if possible
let currentRaceKey = null;
function loadRandomCachedRace() {
  const keys = cache.getCachedRaceKeys();
  if (!keys.length) return false;

  let candidates = keys.filter(k => k !== currentRaceKey);
  if (!candidates.length) candidates = keys; // only one race cached

  const sk = candidates[Math.floor(Math.random() * candidates.length)];
  currentRaceKey = sk;
  cachedRace = cache.getRace(sk);
  console.log(`Selected race from cache: ${cachedRace.title}`);
  return true;
}

// Background: fetch one uncached race, then sleep, repeat
async function prefetchLoop() {
  await ensureSessions();

  while (true) {
    const cachedKeys = cache.getCachedSessionKeys();
    const candidates = sessions.filter(s => !cachedKeys.has(s.session_key) && !cache.isRejected(s.session_key));

    if (!candidates.length) {
      console.log('[prefetch] All races cached or rejected, sleeping 1h');
      await new Promise(r => setTimeout(r, 3600000));
      // Refresh session list in case new races appeared
      sessions = [];
      await ensureSessions();
      continue;
    }

    const session = candidates[Math.floor(Math.random() * candidates.length)];
    const label = `${session.year} ${session.circuit_short_name || session.country_name}`;
    const sk = session.session_key;

    console.log(`[prefetch] Probing: ${label} (session ${sk})`);
    try {
      const hasData = await probeLocationData(sk);
      if (!hasData) {
        console.log(`[prefetch] No location data, rejecting`);
        cache.setRejected(sk);
      } else {
        console.log(`[prefetch] Fetching: ${label}`);
        await fetchAndCacheRace(session);
        console.log(`[prefetch] Cached: ${label}`);
      }
    } catch (err) {
      console.error(`[prefetch] Failed: ${label} - ${err.message}`);
    }

    // Sleep 10 minutes between fetches
    await new Promise(r => setTimeout(r, 600000));
  }
}

// Weather caches
const weatherCache = { current: null, currentAt: 0, race: null, raceKey: null, local: null, localAt: 0 };
const CURRENT_WEATHER_TTL = 15 * 60 * 1000; // 15 minutes
let configuredCityCoords = null;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/race', (req, res) => {
  if (!cachedRace) {
    return res.status(503).json({ error: 'No races cached yet, please wait' });
  }
  res.json(cachedRace);
});

app.get('/api/weather/local', async (req, res) => {
  if (!WEATHER_CITY) {
    return res.status(404).json({ configured: false });
  }

  if (weatherCache.local && Date.now() - weatherCache.localAt < CURRENT_WEATHER_TTL) {
    return res.json(weatherCache.local);
  }

  try {
    if (!configuredCityCoords) {
      configuredCityCoords = await geocodeCity(WEATHER_CITY);
      console.log(`Configured weather city: ${configuredCityCoords.name}, ${configuredCityCoords.country}`);
    }
    const data = await getCurrentWeather(configuredCityCoords.lat, configuredCityCoords.lon);
    data.city = configuredCityCoords.name;
    weatherCache.local = data;
    weatherCache.localAt = Date.now();
    res.json(data);
  } catch (err) {
    console.error('Local weather error:', err.message);
    res.status(502).json({ error: 'Failed to fetch weather for configured city' });
  }
});

app.get('/api/weather/current', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

  const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lon).toFixed(2)}`;
  if (weatherCache.current && weatherCache.currentKey === key && Date.now() - weatherCache.currentAt < CURRENT_WEATHER_TTL) {
    return res.json(weatherCache.current);
  }

  try {
    const data = await getCurrentWeather(lat, lon);
    weatherCache.current = data;
    weatherCache.currentKey = key;
    weatherCache.currentAt = Date.now();
    res.json(data);
  } catch (err) {
    console.error('Weather error:', err.message);
    res.status(502).json({ error: 'Failed to fetch weather' });
  }
});

app.get('/api/weather/race', async (req, res) => {
  if (!cachedRace || !cachedRace.raceDate || !cachedRace.circuitName) {
    return res.status(404).json({ error: 'No race data available' });
  }

  const cacheKey = `${cachedRace.circuitName}:${cachedRace.raceDate}`;
  if (weatherCache.race && weatherCache.raceKey === cacheKey) {
    return res.json(weatherCache.race);
  }

  const coords = getCircuitCoords(cachedRace.circuitName);
  if (!coords) {
    return res.status(404).json({ error: `Unknown circuit: ${cachedRace.circuitName}` });
  }

  try {
    const data = await getHistoricalWeather(coords.lat, coords.lon, cachedRace.raceDate);
    if (!data) return res.status(404).json({ error: 'No historical weather data' });
    weatherCache.race = data;
    weatherCache.raceKey = cacheKey;
    res.json(data);
  } catch (err) {
    console.error('Historical weather error:', err.message);
    res.status(502).json({ error: 'Failed to fetch historical weather' });
  }
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Always serve from cache
  if (!loadRandomCachedRace()) {
    // First ever run — no cache at all, must bootstrap one race
    console.log('No cached races, bootstrapping first race...');
    await ensureSessions();
    const shuffled = [...sessions].sort(() => Math.random() - 0.5);
    for (const session of shuffled) {
      if (cache.isRejected(session.session_key)) continue;
      const label = `${session.year} ${session.circuit_short_name || session.country_name}`;
      console.log(`Probing: ${label}...`);
      const hasData = await probeLocationData(session.session_key);
      if (!hasData) {
        console.log('  No location data, rejecting');
        cache.setRejected(session.session_key);
        continue;
      }
      console.log('  Fetching...');
      cachedRace = await fetchAndCacheRace(session);
      currentRaceKey = session.session_key;
      console.log(`Bootstrapped: ${cachedRace.title}`);
      break;
    }
  }

  // Background: slowly fill the cache one race at a time
  prefetchLoop().catch(err => console.error('[prefetch] Fatal:', err.message));

  // Pick a new race at each wall-clock hour boundary
  function scheduleNextRaceSwap() {
    const now = Date.now();
    const msUntilNextHour = 3600000 - (now % 3600000);
    setTimeout(() => {
      loadRandomCachedRace();
      scheduleNextRaceSwap();
    }, msUntilNextHour + 500); // +500ms buffer so the frontend has rolled over
  }
  scheduleNextRaceSwap();
});
