import http, { ServerResponse, IncomingMessage } from "http";

type Router = (req: IncomingMessage, res: ServerResponse) => void;

function createServer(port: number, router: Router) {
  const server = http.createServer(router);
  const start = () => {
    server.listen(port, () => {
      console.log(`HTTP Server listening on port ${port}`);
    });
  };
  return {
    server,
    start,
  };
}

const ABOUT_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>About - adapt-testing</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
      code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
      pre { background: #f4f4f4; padding: 0.75rem; border-radius: 5px; overflow-x: auto; }
      h1 { margin-bottom: 0.25rem; }
      .muted { color: #666; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <h1>adapt-testing</h1>
    <p class="muted">A minimal Node.js HTTP server written in TypeScript.</p>

    <h2>Overview</h2>
    <p>This app is a small sandbox/testing project that boots a Node <code>http</code> server on port <code>8080</code>. It is intentionally dependency-light and uses native Node APIs only.</p>

    <h2>Routes</h2>
    <ul>
      <li><code>GET /</code> - Returns a simple "Hello World" HTML page.</li>
      <li><code>GET /about</code> - Returns this documentation page.</li>
    </ul>

    <h2>Running locally</h2>
    <pre>npm install
npm start</pre>
    <p>Then visit <a href="http://localhost:8080/">http://localhost:8080/</a>.</p>

    <h2>Project layout</h2>
    <ul>
      <li><code>src/main.ts</code> - Server entrypoint and route handlers.</li>
      <li><code>package.json</code> - Scripts and dev dependencies (<code>@types/node</code>).</li>
    </ul>

    <h2>Tech</h2>
    <ul>
      <li>Node.js (ESM)</li>
      <li>TypeScript types via <code>@types/node</code></li>
      <li>No runtime dependencies</li>
    </ul>
  </body>
</html>`;

const router: Router = (req, res) => {
  const url = req.url ?? "/";

  if (url === "/about") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(ABOUT_HTML);
    return;
  }

  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Hello World</h1></body></html>");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
};

async function main() {
  const server = createServer(8080, router);
  server.start();
}
main();
