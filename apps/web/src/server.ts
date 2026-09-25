import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const root = join(process.cwd(), "public");
const port = Number(process.env.PORT ?? "3001");
const host = process.env.HOST ?? "0.0.0.0";
const apiBaseUrl = process.env.API_BASE_URL ?? "";

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  const requestedUrl = new URL(request.url ?? "/", "http://eve-trade.local");

  if (requestedUrl.pathname === "/__runtime-config.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      `window.EVE_TRADE_API_BASE = ${JSON.stringify(apiBaseUrl)};\n`,
    );
    return;
  }

  const requested = normalize(
    requestedUrl.pathname === "/" ? "/index.html" : requestedUrl.pathname,
  );
  if (requested.includes("..")) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid path");
    return;
  }

  const filePath = join(root, requested);
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`EVE Trade v2 Web listening on http://${host}:${port}\n`);
});
