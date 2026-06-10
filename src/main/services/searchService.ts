import type { SearchRequest, SearchResponse, SearchResult } from "../../shared/types";
import { AI_RERANK_CANDIDATES, DEFAULT_SEARCH_LIMIT } from "../../shared/constants";
import { DatabaseService } from "./database";
import { extractFastFeatureVariants } from "./imageFeatures";
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
    const queryVariants = await extractFastFeatureVariants(request.imagePath);
    const primaryQuery = queryVariants[0];
    if (!primaryQuery) throw new Error("Could not extract visual features from the query image.");
    const modelStatus = this.modelService.getStatus();
    const queryEmbedding = await this.modelService.embedImage(request.imagePath, primaryQuery.fastVector);
    const corpus = this.database.getCorpus();
    const initialCandidateLimit = Math.max(AI_RERANK_CANDIDATES * 2, limit);

    const fastRanked = corpus
      .map((item) => {
        const bestFastMatch = scoreAgainstQueryVariants(queryVariants, item);

        return {
          design: item.design,
          fastScore: bestFastMatch.fastScore,
          hashDistance: bestFastMatch.hashDistance,
          item
        };
      })
      .sort((a, b) => b.fastScore - a.fastScore)
      .slice(0, initialCandidateLimit);

    const designQueryVariants = await extractFastFeatureVariants(request.imagePath, {
      rotations: [0, 90, 180, 270]
    });
    const designFocusedRanked = fastRanked
      .map((candidate) => {
        const rotatedMatch = scoreAgainstQueryVariants(designQueryVariants, candidate.item);
        return rotatedMatch.fastScore > candidate.fastScore
          ? {
              ...candidate,
              fastScore: rotatedMatch.fastScore,
              hashDistance: rotatedMatch.hashDistance
            }
          : candidate;
      })
      .sort((a, b) => b.fastScore - a.fastScore)
      .slice(0, Math.max(AI_RERANK_CANDIDATES, limit));

    let results: SearchResult[] = designFocusedRanked
      .map((candidate) => {
        const aiScore =
          candidate.item.modelVersion === modelStatus.modelVersion &&
          queryEmbedding.length > 0 &&
          candidate.item.aiEmbedding.length > 0
            ? cosineSimilarity(queryEmbedding, candidate.item.aiEmbedding)
            : undefined;
        const aiWeight = modelStatus.mode === "onnx" ? 0.55 : 0.05;
        const score =
          aiScore === undefined
            ? candidate.fastScore
            : candidate.fastScore * (1 - aiWeight) + aiScore * aiWeight;
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
      modelStatus,
      elapsedMs: Date.now() - startedAt,
      results
    };
  }
}

function scoreAgainstQueryVariants(
  queryVariants: Array<{ fastVector: number[]; perceptualHash: string }>,
  item: { fastVector: ArrayLike<number>; perceptualHash: string }
): { fastScore: number; hashDistance: number } {
  return queryVariants.reduce(
    (best, queryFeatures) => {
      const vectorScore = cosineSimilarity(queryFeatures.fastVector, item.fastVector);
      const hashDistance = hammingDistance(queryFeatures.perceptualHash, item.perceptualHash);
      const hashScore = scoreFromHashDistance(hashDistance);
      const combinedFastScore = vectorScore * 0.82 + hashScore * 0.18;
      return combinedFastScore > best.fastScore
        ? {
            fastScore: combinedFastScore,
            hashDistance
          }
        : best;
    },
    { fastScore: -1, hashDistance: 64 }
  );
}
