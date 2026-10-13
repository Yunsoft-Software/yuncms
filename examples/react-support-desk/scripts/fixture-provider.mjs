import { createServer } from "node:http";
import { fixtureOutput } from "./fixture-output.mjs";
// A deterministic testing double, NOT an AI model. Never use as evidence of inference quality.
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 50000) {
      res.writeHead(413).end();
      return;
    }
  }
  try {
    const body = JSON.parse(raw);
    const input = JSON.parse(body.messages[1].content).record;
    const output = fixtureOutput(input);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          { message: { role: "assistant", content: JSON.stringify(output) } },
        ],
      }),
    );
  } catch {
    res.writeHead(400).end();
  }
});
server.listen(3059, "127.0.0.1", () =>
  console.log(
    "Deterministic fixture at 127.0.0.1:3059; no model inference or external calls.",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close());
