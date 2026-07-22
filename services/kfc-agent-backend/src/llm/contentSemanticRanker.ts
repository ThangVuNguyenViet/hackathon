import type { ContentEvidence } from '../ordering/types.js';

export interface ContentSemanticRanker {
  rank(query: string, candidates: ContentEvidence[]): Promise<ContentEvidence[]>;
}

export interface OpenAIContentSemanticRankerOptions {
  client: EmbeddingsClientLike;
}

export interface EmbeddingsClientLike {
  embeddings: {
    create(request: {
      model: string;
      input: string[];
      encoding_format: 'float';
    }): Promise<{
      data: Array<{ index: number; embedding: number[] }>;
    }>;
  };
}

const model = 'text-embedding-3-small';
const resultLimit = 3;

function candidateKey(candidate: ContentEvidence): string {
  return candidate.contentHash ?? `${candidate.id}:${candidate.snippet}`;
}

function candidateText(candidate: ContentEvidence): string {
  return [candidate.title, ...(candidate.tags ?? []), candidate.snippet].join('\n');
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error('Embedding vectors must have the same non-zero dimensions');
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export class OpenAIContentSemanticRanker implements ContentSemanticRanker {
  private readonly client: EmbeddingsClientLike;
  private readonly candidateEmbeddings = new Map<string, number[]>();

  constructor(options: OpenAIContentSemanticRankerOptions) {
    this.client = options.client;
  }

  async rank(query: string, candidates: ContentEvidence[]): Promise<ContentEvidence[]> {
    const semanticQuery = query.trim();
    if (!semanticQuery || candidates.length <= 1) return candidates.slice(0, resultLimit);

    const missingCandidates = candidates.filter(
      (candidate) => !this.candidateEmbeddings.has(candidateKey(candidate)),
    );
    const embeddings = await this.createEmbeddings([
      semanticQuery,
      ...missingCandidates.map(candidateText),
    ]);
    const queryEmbedding = embeddings[0];
    if (!queryEmbedding) throw new Error('OpenAI embeddings response omitted the query embedding');

    missingCandidates.forEach((candidate, index) => {
      const embedding = embeddings[index + 1];
      if (!embedding) throw new Error('OpenAI embeddings response omitted a content embedding');
      this.candidateEmbeddings.set(candidateKey(candidate), embedding);
    });

    return candidates
      .map((candidate) => ({
        candidate,
        score: cosineSimilarity(
          queryEmbedding,
          this.candidateEmbeddings.get(candidateKey(candidate)) ?? [],
        ),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, resultLimit)
      .map(({ candidate }) => candidate);
  }

  private async createEmbeddings(input: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model,
      input,
      encoding_format: 'float',
    });
    return response.data
      .sort((left, right) => left.index - right.index)
      .map(({ embedding }) => embedding);
  }
}
