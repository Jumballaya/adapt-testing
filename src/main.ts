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

const ABOUT_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>About - Adapt Testing</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
      h1 { border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
      code { background: #f4f4f4; padding: 0.1rem 0.35rem; border-radius: 3px; }
      .route { margin: 0.5rem 0; }
      a { color: #0366d6; }
    </style>
  </head>
  <body>
    <h1>About Adapt Testing</h1>
    <p>A minimal Node.js HTTP server written in TypeScript, used as a sandbox for testing Adapt workflows.</p>

    <h2>Tech stack</h2>
    <ul>
      <li>Node.js built-in <code>http</code> module</li>
      <li>TypeScript (ES modules)</li>
      <li>No external runtime dependencies</li>
    </ul>

    <h2>Routes</h2>
    <div class="route"><code>GET /</code> &mdash; Hello World landing page.</div>
    <div class="route"><code>GET /about</code> &mdash; This page. Documentation for the app.</div>

    <h2>Running locally</h2>
    <p>Start the server with <code>npm start</code>. It listens on port <code>8080</code>.</p>

    <h2>Source</h2>
    <p><a href="https://github.com/Jumballaya/adapt-testing">github.com/Jumballaya/adapt-testing</a></p>
  </body>
</html>`;

async function main() {
  const server = createServer(8080, (req, res) => {
    const url = (req.url ?? "/").split("?")[0];

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
  });
  server.start();
}
main();
