import { request } from "../scripts/http.ts";

/**
 * Open-Meteo — no auth required, included as a recipe so callers can use the
 * shared `request()` helper (timeout, retry, JSON parse) without copying
 * fetch boilerplate. No secret registration needed.
 */
const BASE = "https://api.open-meteo.com/v1";

export type CurrentWeather = {
  latitude: number;
  longitude: number;
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
  };
};

export async function getCurrentWeather(lat: number, lon: number): Promise<CurrentWeather> {
  return request<CurrentWeather>(`${BASE}/forecast`, {
    query: {
      latitude: lat,
      longitude: lon,
      current: "temperature_2m,relative_humidity_2m,wind_speed_10m",
    },
  });
}

export async function getDailyForecast(lat: number, lon: number, days = 7) {
  return request(`${BASE}/forecast`, {
    query: {
      latitude: lat,
      longitude: lon,
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
      forecast_days: days,
      timezone: "auto",
    },
  });
}
