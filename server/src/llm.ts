import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Classifier } from "./review";

const reviewSchema = z.object({
  label: z.enum(["sensitive", "not_sensitive"]),
  reason: z.string().max(300),
});

const SYSTEM = `You judge whether a masked snippet contains sensitive personal data.
The candidate is wrapped in <<...>> with digits replaced by 9 and letters by a/A; other findings appear as [TYPE] placeholders.
Reply with ONLY a JSON object: {"label":"sensitive"|"not_sensitive","reason":"<one short sentence>"}.`;

export function createAnthropicClassifier(apiKey: string, model = "claude-haiku-5-5"): Classifier {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return async (req, signal) => {
    const msg = await client.messages.create(
      {
        model,
        max_tokens: 200,
        system: SYSTEM,
        messages: [
          { role: "user", content: `Candidate type: ${req.type}\nSnippet: ${req.context}` },
        ],
      },
      { signal },
    );
    const block = msg.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "";
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return reviewSchema.parse(JSON.parse(json));
  };
}
