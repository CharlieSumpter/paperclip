import { request } from "../scripts/http.ts";

/**
 * Nager.Date — public holiday data. No auth, no secret.
 * Useful for: scheduling logic, "is today a US/UK/JP holiday?" gates, calendar.
 */
const BASE = "https://date.nager.at/api/v3";

export type Holiday = {
  date: string;          // YYYY-MM-DD
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
};

export async function getPublicHolidays(year: number, countryCode: string): Promise<Holiday[]> {
  return request<Holiday[]>(`${BASE}/PublicHolidays/${year}/${countryCode.toUpperCase()}`);
}

export async function isTodayPublicHoliday(countryCode: string): Promise<boolean> {
  const res = await request<unknown>(
    `${BASE}/IsTodayPublicHoliday/${countryCode.toUpperCase()}`,
    { retries: 1 },
  );
  // The endpoint returns 200 (true) or 204 (false) — `request()` returns null on empty bodies.
  return res !== null;
}

export async function getNextHolidaysWorldwide(): Promise<Holiday[]> {
  return request<Holiday[]>(`${BASE}/NextPublicHolidaysWorldwide`);
}
