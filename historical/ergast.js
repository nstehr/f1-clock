// Ergast API client (via jolpi.ca mirror)
const BASE = 'https://api.jolpi.ca/ergast/f1';

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const wait = (i + 1) * 5000;
      console.log(`    Rate limited, waiting ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Ergast error: ${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

async function getSeason(year) {
  const data = await fetchJson(`${BASE}/${year}.json`);
  return data.MRData.RaceTable.Races;
}

async function getRaceResults(year, round) {
  const data = await fetchJson(`${BASE}/${year}/${round}/results.json`);
  return data.MRData.RaceTable.Races[0] || null;
}

async function getLaps(year, round) {
  // Ergast paginates by timing records (laps × drivers), not by lap number
  // A 78-lap race with 20 drivers = 1560 records, need multiple fetches
  // API seems to cap at ~100 records per response regardless of limit param
  const lapsMap = new Map(); // lapNumber -> Timings[]
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await fetchJson(`${BASE}/${year}/${round}/laps.json?limit=${limit}&offset=${offset}`);
    const total = parseInt(data.MRData.total, 10);
    const raceLaps = data.MRData.RaceTable.Races[0]?.Laps || [];

    if (!raceLaps.length) break;

    for (const lap of raceLaps) {
      const lapNum = lap.number;
      if (!lapsMap.has(lapNum)) {
        lapsMap.set(lapNum, { number: lapNum, Timings: [] });
      }
      lapsMap.get(lapNum).Timings.push(...lap.Timings);
    }

    offset += limit;
    if (offset >= total) break;
  }

  // Return sorted by lap number
  return Array.from(lapsMap.values()).sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
}

async function getPitStops(year, round) {
  // Pit stop data only available from 2012 onward
  if (year < 2012) return [];

  try {
    const data = await fetchJson(`${BASE}/${year}/${round}/pitstops.json`);
    return data.MRData.RaceTable.Races[0]?.PitStops || [];
  } catch {
    return [];
  }
}

async function getQualifying(year, round) {
  try {
    const data = await fetchJson(`${BASE}/${year}/${round}/qualifying.json`);
    return data.MRData.RaceTable.Races[0]?.QualifyingResults || [];
  } catch {
    return [];
  }
}

module.exports = { getSeason, getRaceResults, getLaps, getPitStops, getQualifying };
