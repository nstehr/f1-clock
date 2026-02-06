#!/usr/bin/env node
// CLI tool to generate historical race data

const fs = require('fs');
const path = require('path');
const { generateRace } = require('./generate');
const { getSeason } = require('./ergast');

const OUTPUT_DIR = path.join(__dirname, 'output');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
F1 Historical Race Generator

Usage:
  node index.js <year> <round>     Generate a specific race
  node index.js <year>             Generate all races in a season
  node index.js --list <year>      List races in a season
  node index.js --all              Generate all races 1996-2022

Examples:
  node index.js 1998 6             Generate 1998 Monaco GP
  node index.js 2010               Generate all 2010 races
  node index.js --list 2005        List 2005 season races
`);
    return;
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (args[0] === '--list') {
    const year = parseInt(args[1], 10);
    if (!year || year < 1950 || year > 2030) {
      console.error('Invalid year');
      process.exit(1);
    }
    await listSeason(year);
    return;
  }

  if (args[0] === '--all') {
    await generateAllSeasons();
    return;
  }

  const year = parseInt(args[0], 10);
  if (!year || year < 1950 || year > 2030) {
    console.error('Invalid year');
    process.exit(1);
  }

  if (args[1]) {
    // Single race
    const round = parseInt(args[1], 10);
    await generateSingleRace(year, round);
  } else {
    // Full season
    await generateSeason(year);
  }
}

async function listSeason(year) {
  console.log(`\n${year} Season:\n`);
  const races = await getSeason(year);
  for (const race of races) {
    console.log(`  Round ${race.round}: ${race.raceName} (${race.Circuit.circuitId})`);
  }
  console.log(`\nTotal: ${races.length} races\n`);
}

async function generateSingleRace(year, round) {
  try {
    const raceData = await generateRace(year, round);
    const filename = `${year}-${round.toString().padStart(2, '0')}-${raceData.circuitName.toLowerCase().replace(/\s+/g, '-')}.json`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(raceData, null, 2));
    console.log(`\nSaved to: ${filepath}`);
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
  }
}

async function generateSeason(year) {
  console.log(`\nGenerating ${year} season...\n`);
  const races = await getSeason(year);

  let success = 0, failed = 0;
  for (const race of races) {
    try {
      const raceData = await generateRace(year, parseInt(race.round, 10));
      const filename = `${year}-${race.round.toString().padStart(2, '0')}-${raceData.circuitName.toLowerCase().replace(/\s+/g, '-')}.json`;
      const filepath = path.join(OUTPUT_DIR, filename);
      fs.writeFileSync(filepath, JSON.stringify(raceData, null, 2));
      console.log(`  Saved: ${filename}`);
      success++;
    } catch (err) {
      console.error(`  Failed round ${race.round}: ${err.message}`);
      failed++;
    }

    // Delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\nComplete: ${success} succeeded, ${failed} failed\n`);
}

async function generateAllSeasons() {
  console.log('\nGenerating all seasons 1996-2022...\n');

  for (let year = 1996; year <= 2022; year++) {
    console.log(`\n=== ${year} ===\n`);
    await generateSeason(year);

    // Delay between seasons
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\nAll done!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
