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

async function main() {
  const server = createServer(8080, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h1>Hello World</h1></body></html>");
  });
  server.start();
}
main();
