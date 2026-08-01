import { config } from "./config";

// Embedding Provider（可插拔）。默认本地确定性 hash 向量，无需 Key，可切 OpenAI。
// RAG 统一把向量存为 JSON，检索时在应用层算余弦相似度 —— SQLite / Postgres 通用。

const DIM = 256;

// 本地 embedding：基于中文二元组 + 词 hash 的 bag-of-features 向量。
// 不是精确关键词匹配，而是语义近似的相似度信号，满足“embedding 相似度检索”的最小要求。
function localEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const clean = text.toLowerCase().replace(/\s+/g, "");
  // 一元 + 二元字符特征
  const grams: string[] = [];
  for (let i = 0; i < clean.length; i++) {
    grams.push(clean[i]);
    if (i + 1 < clean.length) grams.push(clean[i] + clean[i + 1]);
  }
  for (const g of grams) {
    const h = hash(g) % DIM;
    vec[h] += 1;
  }
  // L2 归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

async function openaiEmbed(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.embedding.openaiApiKey}`,
    },
    body: JSON.stringify({ input: text, model: config.embedding.openaiModel }),
  });
  if (!res.ok) throw new Error(`OpenAI embedding 失败: ${res.status}`);
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

export async function embed(text: string): Promise<number[]> {
  if (config.embedding.provider === "openai" && config.embedding.openaiApiKey) {
    return openaiEmbed(text);
  }
  return localEmbed(text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
