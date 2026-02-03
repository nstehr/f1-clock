// F1 circuit coordinates mapped by circuit_short_name from OpenF1
const CIRCUITS = {
  'Sakhir':              { lat: 26.0325, lon: 50.5106 },
  'Jeddah':              { lat: 21.6319, lon: 39.1044 },
  'Melbourne':           { lat: -37.8497, lon: 144.9680 },
  'Baku':                { lat: 40.3725, lon: 49.8533 },
  'Miami':               { lat: 25.9581, lon: -80.2389 },
  'Imola':               { lat: 44.3439, lon: 11.7167 },
  'Monte Carlo':         { lat: 43.7347, lon: 7.4206 },
  'Catalunya':           { lat: 41.5700, lon: 2.2611 },
  'Montreal':            { lat: 45.5000, lon: -73.5228 },
  'Spielberg':           { lat: 47.2197, lon: 14.7647 },
  'Silverstone':         { lat: 52.0786, lon: -1.0169 },
  'Hungaroring':         { lat: 47.5789, lon: 19.2486 },
  'Spa-Francorchamps':   { lat: 50.4372, lon: 5.9714 },
  'Zandvoort':           { lat: 52.3888, lon: 4.5409 },
  'Monza':               { lat: 45.6156, lon: 9.2811 },
  'Singapore':           { lat: 1.2914, lon: 103.8640 },
  'Suzuka':              { lat: 34.8431, lon: 136.5406 },
  'Lusail':              { lat: 25.4900, lon: 51.4542 },
  'Austin':              { lat: 30.1328, lon: -97.6411 },
  'Mexico City':         { lat: 19.4042, lon: -99.0907 },
  'Interlagos':          { lat: -23.7014, lon: -46.6969 },
  'Las Vegas':           { lat: 36.1147, lon: -115.1728 },
  'Yas Marina Circuit':  { lat: 24.4672, lon: 54.6031 },
  'Shanghai':            { lat: 31.3389, lon: 121.2197 },
};

function getCircuitCoords(circuitShortName) {
  return CIRCUITS[circuitShortName] || null;
}

module.exports = { getCircuitCoords };
