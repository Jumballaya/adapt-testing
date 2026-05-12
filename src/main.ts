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

const ADAPT_DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Using Adapt</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        max-width: 760px;
        margin: 2.5rem auto;
        padding: 0 1.25rem;
        line-height: 1.6;
      }
      h1 { margin-bottom: 0.25rem; }
      h2 { margin-top: 2rem; }
      code, pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        background: rgba(127, 127, 127, 0.15);
        border-radius: 4px;
      }
      code { padding: 0.1rem 0.35rem; }
      pre { padding: 0.85rem 1rem; overflow-x: auto; }
      ul { padding-left: 1.25rem; }
      a { color: #2563eb; }
      .lede { color: #6b7280; margin-top: 0; }
    </style>
  </head>
  <body>
    <h1>Using Adapt</h1>
    <p class="lede">Adapt is the AI computer for your business. This page is a quick reference for working with it.</p>

    <h2>What Adapt does</h2>
    <ul>
      <li>Connects to the tools you already use (Slack, GitHub, Google Workspace, Notion, Linear, HubSpot, and more).</li>
      <li>Runs analysis, drafts content, and takes actions on your behalf across those integrations.</li>
      <li>Automates recurring work with scheduled tasks and reusable skills.</li>
    </ul>

    <h2>Getting started</h2>
    <ol>
      <li>Sign in at <a href="https://app.adapt.com">app.adapt.com</a>.</li>
      <li>Connect integrations from <a href="https://app.adapt.com/settings/integrations">Settings &rarr; Integrations</a>.</li>
      <li>Open a chat and describe the outcome you want. Adapt picks the right tools.</li>
    </ol>

    <h2>Example prompts</h2>
    <pre><code>Summarize unread Slack DMs from the last 24 hours.
Open a PR on adapt-testing that adds a /health route.
Pull this week's HubSpot deals into a CSV and chart them by stage.
Every Monday at 9am, post a status update in #engineering.</code></pre>

    <h2>Scheduling work</h2>
    <p>Ask Adapt to schedule any task. Examples:</p>
    <ul>
      <li><em>"Remind me in 2 hours to review the deploy."</em></li>
      <li><em>"Every weekday at 8am, send me a digest of new GitHub issues."</em></li>
    </ul>

    <h2>Useful links</h2>
    <ul>
      <li><a href="https://adapt.com/docs/llms.txt">Docs index</a></li>
      <li><a href="https://adapt.com/docs/integrations/overview">Integrations overview</a></li>
      <li><a href="https://app.adapt.com/settings/integrations">Manage integrations</a></li>
    </ul>
  </body>
</html>`;

const router: Router = (req, res) => {
  const url = (req.url ?? "/").split("?")[0];

  if (url === "/adapt") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ADAPT_DOCS_HTML);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<html><body><h1>Hello World</h1></body></html>");
};

async function main() {
  const server = createServer(8080, router);
  server.start();
}
main();
