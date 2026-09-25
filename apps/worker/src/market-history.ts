import type { MarketHistoryBuildResult } from "@eve-trade/contracts";
import { buildMarketHistory } from "@eve-trade/domain";
import { MarketHistoryRepository, MarketObservationRepository } from "@eve-trade/db";

export async function rebuildMarketHistory(
  source: Pick<MarketObservationRepository, "listCollections" | "loadPages">,
  target: MarketHistoryRepository,
): Promise<MarketHistoryBuildResult> {
  const collections = await source.listCollections();
  const inputs = await Promise.all(
    collections.map(async (collection) => ({
      collection,
      pages: await source.loadPages(collection.collection_id),
    })),
  );
  const result = buildMarketHistory(inputs);
  await target.replace(result);
  return result;
}
