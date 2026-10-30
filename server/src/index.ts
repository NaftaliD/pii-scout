import { createApp } from "./app";
import { createAnthropicClassifier } from "./llm";

const port = Number(process.env.PORT) || 3000;

const apiKey = process.env.LLM_API_KEY;
const classifier = apiKey ? createAnthropicClassifier(apiKey) : undefined;
if (!classifier) console.warn("LLM_API_KEY not set: ambiguous findings will not be reviewed");

createApp({ classifier }).listen(port, "0.0.0.0", () => {
  console.log(`scanner listening on 0.0.0.0:${port}`);
});
