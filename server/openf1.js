const BASE = 'https://api.openf1.org/v1';

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (res.status === 429) {
        const wait = (i + 1) * 5000;
        console.log(`Rate limited, waiting ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`OpenF1 error: ${res.status} ${url}`);
      return res.json();
    } catch (err) {
      if (i < retries - 1) {
        const wait = (i + 1) * 5000;
        console.log(`Network error (${err.cause?.code || err.message}), retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

async function getRaceSessions() {
  const sessions = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  for (let year = 2018; year <= currentYear; year++) {
    const data = await fetchJson(`${BASE}/sessions?session_type=Race&year=${year}`);
    sessions.push(...data);
  }
  // Only include races that have already happened
  return sessions.filter(s => s.date_start && new Date(s.date_start) < now);
}

async function probeLocationData(sessionKey) {
  // Quick check: fetch location for one driver to see if data exists
  const drivers = await fetchJson(`${BASE}/drivers?session_key=${sessionKey}`);
  if (!drivers.length) return false;
  const dn = drivers[0].driver_number;
  const data = await fetchJson(`${BASE}/location?session_key=${sessionKey}&driver_number=${dn}`);
  // Need non-zero points to be useful
  const hasData = data.some(d => d.x !== 0 || d.y !== 0);
  return hasData;
}

async function getDrivers(sessionKey) {
  return fetchJson(`${BASE}/drivers?session_key=${sessionKey}`);
}

async function getPositions(sessionKey) {
  return fetchJson(`${BASE}/position?session_key=${sessionKey}`);
}

async function getLaps(sessionKey) {
  return fetchJson(`${BASE}/laps?session_key=${sessionKey}`);
}

async function getRaceControl(sessionKey) {
  return fetchJson(`${BASE}/race_control?session_key=${sessionKey}`);
}

async function getStints(sessionKey) {
  return fetchJson(`${BASE}/stints?session_key=${sessionKey}`);
}

async function getLocationData(sessionKey, driverNumbers) {
  const all = [];
  for (const dn of driverNumbers) {
    console.log(`  Fetching location for driver ${dn}...`);
    const data = await fetchJson(`${BASE}/location?session_key=${sessionKey}&driver_number=${dn}`);
    all.push(...data);
  }
  return all;
}

async function getDriverLocationData(sessionKey, driverNumber) {
  return fetchJson(`${BASE}/location?session_key=${sessionKey}&driver_number=${driverNumber}`);
}

module.exports = { getRaceSessions, getLocationData, getDriverLocationData, getDrivers, getPositions, getLaps, getRaceControl, getStints, probeLocationData };
