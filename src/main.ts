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

const ABOUT_ME_HTML = `<html>
  <head>
    <title>About Adapt</title>
  </head>
  <body>
    <h1>About Adapt</h1>
    <p>
      Adapt is the AI computer for your business. It connects to the tools your
      team already uses (Slack, GitHub, Google Workspace, Notion, HubSpot,
      databases, and more) and helps you analyze data, generate insights, and
      take action across them from a single chat-based interface.
    </p>
    <h2>What Adapt can do</h2>
    <ul>
      <li>Answer questions using your organization's data and integrations.</li>
      <li>Run code, query databases, and crawl the web in a secure sandbox.</li>
      <li>Automate repetitive workflows with scheduled and recurring tasks.</li>
      <li>Build and deploy small apps and reusable skills for your team.</li>
      <li>Maintain a shared knowledge base of facts, schemas, and procedures.</li>
    </ul>
    <p>Learn more at <a href="https://adapt.com">adapt.com</a>.</p>
  </body>
</html>`;

async function main() {
  const server = createServer(8080, (req, res) => {
    if (req.url === "/about-me") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(ABOUT_ME_HTML);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Hello World</h1></body></html>");
  });
  server.start();
}
main();
