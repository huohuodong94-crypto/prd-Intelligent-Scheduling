import { prisma } from "./db";
import { embed, cosineSimilarity } from "./embedding";

export type RetrievedChunk = {
  id: string;
  title: string;
  category: string;
  content: string;
  score: number;
};

// RAG 检索：把问题 embedding 后，与规则库所有片段算余弦相似度，取 topK。
// 内存计算，DB 无关；未来接 pgvector 只需替换本函数内部实现。
export async function retrieveRules(
  query: string,
  topK = 3,
  minScore = 0.05
): Promise<RetrievedChunk[]> {
  const qVec = await embed(query);
  const chunks = await prisma.ruleChunk.findMany();

  const scored = chunks.map((c) => {
    let vec: number[] = [];
    try {
      vec = JSON.parse(c.embedding) as number[];
    } catch {
      vec = [];
    }
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      content: c.content,
      score: vec.length ? cosineSimilarity(qVec, vec) : 0,
    };
  });

  return scored
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
