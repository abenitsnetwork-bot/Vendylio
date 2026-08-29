// Phase 11 — "Generate with AI" for the product form and store setup form.
// A single short-copy call to claude-haiku-4-5 — no agent loop, no tool use,
// no conversation state. The model never sees anything beyond the handful of
// fields already visible in the form (name/category/unit or name/city/state).
import 'server-only';
import { getAnthropicClient } from './anthropic-client';

export { AiNotConfiguredError } from './anthropic-client';

const MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_CHARS = 500;

export interface ProductDescriptionInput {
  kind: 'product';
  name: string;
  category?: string | undefined;
  unit?: string | undefined;
}

export interface StoreDescriptionInput {
  kind: 'store';
  name: string;
  city?: string | undefined;
  state?: string | undefined;
}

export type GenerateDescriptionInput = ProductDescriptionInput | StoreDescriptionInput;

function buildPrompt(input: GenerateDescriptionInput): string {
  if (input.kind === 'product') {
    const categoryHint = input.category ? ` in the "${input.category}" category` : '';
    const unitHint =
      input.unit && input.unit !== 'UNIT'
        ? ` It is sold by weight (${input.unit.toLowerCase()}).`
        : '';
    return (
      `Write a short, appealing product description (2-3 sentences, no markdown, no emoji) ` +
      `for a marketplace listing titled "${input.name}"${categoryHint}.${unitHint} ` +
      `Write for a small independent seller's storefront — warm and concrete, no hype words ` +
      `like "amazing" or "premium". Reply with only the description text, nothing else.`
    );
  }
  const locationHint =
    input.city || input.state
      ? ` located in ${[input.city, input.state].filter(Boolean).join(', ')}`
      : '';
  return (
    `Write a short, welcoming store description (2-3 sentences, no markdown, no emoji) for a ` +
    `small independent online shop named "${input.name}"${locationHint}. Write in a warm, ` +
    `personal voice as if the owner is introducing their shop to new customers. Reply with ` +
    `only the description text, nothing else.`
  );
}

/**
 * Generates a short description via a single Anthropic Messages API call.
 * Throws `AiNotConfiguredError` (via getAnthropicClient) when
 * ANTHROPIC_API_KEY is absent — callers translate that to a 503.
 */
export async function generateDescription(input: GenerateDescriptionInput): Promise<string> {
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  return text.slice(0, MAX_OUTPUT_CHARS);
}
