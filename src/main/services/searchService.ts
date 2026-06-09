import type { SearchRequest, SearchResponse, SearchResult } from "../../shared/types";
import { AI_RERANK_CANDIDATES, DEFAULT_SEARCH_LIMIT } from "../../shared/constants";
import { DatabaseService } from "./database";
import { extractFastFeatures } from "./imageFeatures";
import { ModelService } from "./modelService";
import { OpenAiEnhancer } from "./openAiEnhancer";
import { cosineSimilarity, hammingDistance, scoreFromHashDistance } from "./vector";

export class SearchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly modelService: ModelService,
    private readonly openAiEnhancer: OpenAiEnhancer
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const startedAt = Date.now();
    const limit = request.limit ?? DEFAULT_SEARCH_LIMIT;
    const queryFeatures = await extractFastFeatures(request.imagePath);
    const queryEmbedding = await this.modelService.embedImage(request.imagePath, queryFeatures.fastVector);
    const corpus = this.database.getCorpus();

    const fastRanked = corpus
      .map((item) => {
        const fastScore = cosineSimilarity(queryFeatures.fastVector, item.fastVector);
        const hashDistance = hammingDistance(queryFeatures.perceptualHash, item.perceptualHash);
        const hashScore = scoreFromHashDistance(hashDistance);
        const combinedFastScore = fastScore * 0.72 + hashScore * 0.28;
        return {
          design: item.design,
          fastScore: combinedFastScore,
          hashDistance,
          item
        };
      })
      .sort((a, b) => b.fastScore - a.fastScore)
      .slice(0, Math.max(AI_RERANK_CANDIDATES, limit));

    let results: SearchResult[] = fastRanked
      .map((candidate) => {
        const aiScore =
          queryEmbedding.length > 0 && candidate.item.aiEmbedding.length > 0
            ? cosineSimilarity(queryEmbedding, candidate.item.aiEmbedding)
            : undefined;
        const score = aiScore === undefined ? candidate.fastScore : candidate.fastScore * 0.45 + aiScore * 0.55;
        return {
          design: candidate.design,
          score,
          fastScore: candidate.fastScore,
          aiScore,
          hashDistance: candidate.hashDistance
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (request.useOnlineEnhancement && this.database.getSettings("").onlineEnhancementEnabled) {
      const apiKey = this.database.getOpenAiApiKey();
      const enhancements = await this.openAiEnhancer.enhanceTopResults({
        apiKey,
        queryImagePath: request.imagePath,
        results
      });
      results = results.map((result) => {
        const enhancement = enhancements.get(result.design.id);
        return enhancement
          ? {
              ...result,
              explanation: enhancement.explanation,
              tags: enhancement.tags
            }
          : result;
      });
    }

    return {
      queryImagePath: request.imagePath,
      modelStatus: this.modelService.getStatus(),
      elapsedMs: Date.now() - startedAt,
      results
    };
  }
}
