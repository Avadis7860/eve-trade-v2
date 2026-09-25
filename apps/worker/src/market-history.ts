import type { MarketHistoryBuildResult } from "@eve-trade/contracts";
import { buildMarketHistory } from "@eve-trade/domain";
import { MarketHistoryRepository, MarketObservationRepository } from "@eve-trade/db";

export async function rebuildMarketHistory(
  source: Pick<MarketObservationRepository, "listCollections" | "loadPages">,
  target: Pick<MarketHistoryRepository, "replace">,
): Promise<MarketHistoryBuildResult> {
  const collections = await source.listCollections();
  const inputs = [];
  for (const collection of collections) {
    inputs.push({
      collection,
      pages: await source.loadPages(collection.collection_id),
    });
  }
  const result = buildMarketHistory(inputs);
  await target.replace(result);
  return result;
}
