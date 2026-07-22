import { describe, expect, it, vi } from 'vitest';
import { OpenAIContentSemanticRanker } from '../../src/llm/contentSemanticRanker.js';
import type { ContentEvidence } from '../../src/ordering/types.js';

function evidence(id: string, title: string): ContentEvidence {
  return {
    id,
    kind: 'policy',
    title,
    snippet: `${title} official guidance`,
    sourceUrl: `https://kfcvietnam.com.vn/${id}`,
    sourceFile: `${id}.md`,
    contentHash: id,
    approvalStatus: 'approved',
    audience: 'customer_public',
  };
}

describe('OpenAIContentSemanticRanker', () => {
  it('ranks approved evidence by semantic similarity and caches content embeddings', async () => {
    const candidates = [
      evidence('allergen', 'Allergen chart'),
      evidence('privacy', 'Privacy and personal data'),
      evidence('delivery', 'Delivery policy'),
      evidence('contact', 'Customer support'),
    ];
    const responses = [
      [
        [1, 0],
        [0, 1],
        [0.99, 0.01],
        [0.7, 0.7],
        [0.3, 0.7],
      ],
      [[0, 1]],
    ];
    const create = vi.fn(async ({ input }: { input: string[] }) => {
      const embeddings = responses.shift();
      expect(embeddings).toBeDefined();
      if (!embeddings) throw new Error('Missing fake embedding response');
      expect(input).toHaveLength(embeddings.length);
      return {
        data: embeddings.map((embedding, index) => ({ index, embedding })),
      };
    });
    const ranker = new OpenAIContentSemanticRanker({
      client: { embeddings: { create } },
    });

    await expect(ranker.rank('How is my information protected?', candidates))
      .resolves.toEqual([candidates[1], candidates[2], candidates[3]]);
    await expect(ranker.rank('food sensitivity details', candidates))
      .resolves.toEqual([candidates[0], candidates[3], candidates[2]]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: ['food sensitivity details'],
        model: 'text-embedding-3-small',
      }),
    );
  });
});
