import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handler } from "./api/handler";

const MAX_BODY_BYTES = 1_048_576;

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds 1 MiB.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createLocalServer() {
  return createServer(async (request, response) => {
    if (request.url !== "/authorize") {
      sendJson(response, 404, { error: "Route not found." });
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    try {
      const result = await handler({ body: await readBody(request) });
      response.writeHead(result.statusCode, result.headers);
      response.end(result.body);
    } catch {
      sendJson(response, 413, { error: "Request body exceeds 1 MiB." });
    }
  });
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  createLocalServer().listen(port, () => {
    console.log(`CedarGate listening on http://localhost:${port}`);
  });
}
