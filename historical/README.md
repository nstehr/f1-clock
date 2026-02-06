# F1 Historical Race Generator

Generates race animation data for historical F1 races (1996-2022) by interpolating continuous car positions from lap timing data.

## Data Sources

- **Ergast API** (via [jolpi.ca mirror](https://api.jolpi.ca/ergast/)) — lap times, positions, pit stops, driver info
- **f1-circuits** ([GitHub](https://github.com/bacinger/f1-circuits)) — detailed track GeoJSON outlines

## Usage

```bash
# List races in a season
node index.js --list 2005

# Generate a specific race
node index.js 1998 6        # 1998 Monaco GP

# Generate all races in a season
node index.js 2010

# Generate all seasons 1996-2022 (takes a long time!)
node index.js --all
```

Output files are saved to `historical/output/` as JSON in the same format as the main app's race data.

## How It Works

1. Fetches race results and lap timing data from Ergast API
2. Loads track outline from f1-circuits GeoJSON
3. Converts lat/lon coordinates to local x/y meters
4. Builds driver timelines from lap times (cumulative timing)
5. Interpolates car position along track based on lap progress
6. Scales time to fit the playback window (max 55 minutes)

## Limitations

- **No sector times** — cars move at constant speed within each lap
- **No tire compound data** before 2018
- **No safety car/red flag events** from Ergast
- **Some circuits missing** — Korea, India, Valencia, Fuji, etc.
- **Pit stops only from 2012 onwards**

## Circuit Coverage

Available circuits (from f1-circuits repo):
- Albert Park, Bahrain, Shanghai, Barcelona, Monaco
- Montreal, Paul Ricard, Red Bull Ring, Silverstone
- Hockenheim, Hungaroring, Spa, Monza, Singapore
- Sochi, Suzuka, COTA, Mexico, Interlagos
- Yas Marina, Imola, Nürburgring, Istanbul, Sepang
- Zandvoort, Magny-Cours, Indianapolis, and more

Missing circuits (races will fail):
- Yeongam (Korea), Buddh (India), Valencia, Fuji
- Adelaide, Jerez, Aida, Donington

## Output Format

The generated JSON matches the main app's `raceData` structure:

```js
{
  title: "1998 Monaco GP",
  raceDate: "1998-05-24",
  circuitName: "Circuit de Monaco",
  circuitCoords: { lat: 43.7347, lon: 7.42056 },
  trackOutline: [{x, y}, ...],
  trackSectors: null,
  drivers: { [number]: { code, name, team, color } },
  locations: { [number]: [{t, x, y}, ...] },
  positions: { [number]: [{t, position}, ...] },
  totalLaps: 78,
  laps: [{t, lap}, ...],
  events: [],
  pitStops: { [number]: [{t, lap}, ...] },
  fastestLap: { driverNumber, lap, duration, t },
  stints: {},
  raceDurationS: 3300
}
```

## Loading into Main App

Generated race files can be loaded into the main app's SQLite cache using the `setRace` function, or by manually placing them in the cache. The session key can be any unique number (e.g., negative numbers for historical races to avoid conflicts).
