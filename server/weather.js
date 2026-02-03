const WMO_CODES = {
  0: 'CLEAR',
  1: 'MOSTLY CLEAR',
  2: 'PARTLY CLOUDY',
  3: 'OVERCAST',
  45: 'FOG',
  48: 'RIME FOG',
  51: 'LIGHT DRIZZLE',
  53: 'DRIZZLE',
  55: 'HEAVY DRIZZLE',
  56: 'FREEZING DRIZZLE',
  57: 'FREEZING DRIZZLE',
  61: 'LIGHT RAIN',
  63: 'RAIN',
  65: 'HEAVY RAIN',
  66: 'FREEZING RAIN',
  67: 'FREEZING RAIN',
  71: 'LIGHT SNOW',
  73: 'SNOW',
  75: 'HEAVY SNOW',
  77: 'SNOW GRAINS',
  80: 'RAIN SHOWERS',
  81: 'RAIN SHOWERS',
  82: 'HEAVY SHOWERS',
  85: 'SNOW SHOWERS',
  86: 'SNOW SHOWERS',
  95: 'THUNDERSTORM',
  96: 'THUNDERSTORM+HAIL',
  99: 'THUNDERSTORM+HAIL',
};

function describeWeatherCode(code) {
  return WMO_CODES[code] || 'UNKNOWN';
}

async function getCurrentWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
  const data = await res.json();
  const current = data.current;
  return {
    temp: Math.round(current.temperature_2m),
    code: current.weather_code,
    condition: describeWeatherCode(current.weather_code),
  };
}

async function getHistoricalWeather(lat, lon, date) {
  // date should be YYYY-MM-DD
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,weather_code`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo archive error: ${res.status}`);
  const data = await res.json();
  const daily = data.daily;
  if (!daily || !daily.temperature_2m_max || !daily.temperature_2m_max.length) {
    return null;
  }
  return {
    tempHigh: Math.round(daily.temperature_2m_max[0]),
    tempLow: Math.round(daily.temperature_2m_min[0]),
    code: daily.weather_code[0],
    condition: describeWeatherCode(daily.weather_code[0]),
  };
}

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding error: ${res.status}`);
  const data = await res.json();
  if (!data.results || !data.results.length) {
    throw new Error(`City not found: ${city}`);
  }
  const result = data.results[0];
  return {
    lat: result.latitude,
    lon: result.longitude,
    name: result.name,
    country: result.country,
  };
}

module.exports = { getCurrentWeather, getHistoricalWeather, geocodeCity };
