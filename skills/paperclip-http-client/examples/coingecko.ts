import { apiKey } from "../scripts/api-key.ts";

/**
 * CoinGecko Pro API — `x-cg-pro-api-key` header.
 *
 * Free demo tier: replace baseUrl with `https://api.coingecko.com/api/v3` and
 * use `secretName: "COINGECKO_DEMO_KEY"` (still required, just rate-limited).
 *
 * Register the secret once:
 *   POST /api/companies/:companyId/secrets { name: "COINGECKO_KEY", value: "..." }
 */
export const coingecko = apiKey({
  baseUrl: "https://pro-api.coingecko.com/api/v3",
  secretName: "COINGECKO_KEY",
  scheme: "header",
  headerName: "x-cg-pro-api-key",
});

export type CoinPrice = Record<string, Record<string, number>>;

export async function getSimplePrice(
  ids: string[],
  vsCurrencies: string[] = ["usd"],
): Promise<CoinPrice> {
  return coingecko.get<CoinPrice>("/simple/price", {
    ids: ids.join(","),
    vs_currencies: vsCurrencies.join(","),
  });
}

export async function getCoinMarkets(vsCurrency = "usd", perPage = 50, page = 1) {
  return coingecko.get("/coins/markets", {
    vs_currency: vsCurrency,
    order: "market_cap_desc",
    per_page: perPage,
    page,
    sparkline: false,
  });
}
