/**
 * Anthropic first-party API prices, USD per million tokens (cached 2026-09-25).
 * Used to estimate an API-equivalent cost for Claude Code sessions; on a
 * subscription this is not what you are billed.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const p = (input: number, output: number, cacheRead = input * 0.1): Price => ({ input, output, cacheRead });

// Longest prefix wins, so specific versions sit beside their family fallback.
const PRICES: Array<[prefix: string, price: Price]> = [
  ['fable-5-1', p(10, 50, 0.25)],
  ['mythos-5-1', p(10, 50, 0.25)],
  ['fable-5', p(10, 50)],
  ['mythos-5', p(10, 50)],
  ['opus-5-5', p(4, 20, 0.2)],
  ['opus-5', p(5, 25)],
  ['opus-4-8', p(5, 25)],
  ['opus-4-7', p(5, 25)],
  ['opus-4-6', p(5, 25)],
  ['opus-4-5', p(5, 25)],
  ['opus-4', p(15, 75)],
  ['sonnet-5', p(2, 10)],
  ['sonnet-4', p(3, 15)],
  ['sonnet-3', p(3, 15)],
  ['haiku-4', p(1, 5)],
  ['haiku-3-5', p(0.8, 4)],
];

function priceFor(model: string): Price | undefined {
  const id = model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  let best: [string, Price] | undefined;
  for (const entry of PRICES) {
    if (id.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1];
}

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
}

/** Returns null for models without a known price (e.g. synthetic or non-Claude). */
export function claudeCost(model: string, u: ClaudeUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1h);
  const usd =
    (u.input_tokens ?? 0) * price.input +
    write5m * price.input * 1.25 +
    write1h * price.input * 2 +
    (u.cache_read_input_tokens ?? 0) * price.cacheRead +
    (u.output_tokens ?? 0) * price.output;
  return (usd / 1_000_000) * (u.speed === 'fast' ? 2 : 1);
}
