// A fake OpenAI-compatible model for the Mari shell flow tests: streams a fixed roleplay reply with quoted lines,
// so tests run without a real model or account. `startFakeLlm()` listens on a free local port.
import { createServer } from "node:http";

export const REPLY =
  '비가 처마 끝에서 떨어졌다. 그는 우산을 받아 들었다.\n\n"네가 젖으면 내가 곤란해. 그러니까 이쪽으로 붙어."\n\n"…늦었지. 미안."';

export function startFakeLlm() {
  let calls = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "fixture" }] }));
      }
      if (!req.url.endsWith("/chat/completions")) {
        res.writeHead(404);
        return res.end();
      }
      calls += 1;
      const parsed = JSON.parse(body || "{}");
      const text = `${REPLY} (#${calls})`;
      if (!parsed.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            id: "x",
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          }),
        );
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      for (const part of text.match(/[\s\S]{1,24}/g)) res.write(chunk({ content: part }));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() }),
    ),
  );
}
