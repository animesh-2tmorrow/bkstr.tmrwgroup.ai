const PREAMBLE = `You are an assistant answering questions about the following book. Only answer based on the content of the book provided below. If the answer is not in the book, say so clearly. Do not invent or speculate.

---

`;

export function buildSystemPrompt(markdown: string): string {
  return PREAMBLE + markdown;
}

// Coarse 4-chars/token approximation. Good enough for the size-guard gate;
// not accurate enough for billing — see follow-up #28.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const MAX_CONTENT_TOKENS = 150_000;
