import { App } from "./app/index.ts";
import { Router } from "./router/index.ts";

const TOP_MOVIES = [
  { rank: 1, title: "The Shawshank Redemption", year: 1994 },
  { rank: 2, title: "The Godfather", year: 1972 },
  { rank: 3, title: "The Dark Knight", year: 2008 },
  { rank: 4, title: "The Godfather Part II", year: 1974 },
  { rank: 5, title: "12 Angry Men", year: 1957 },
  { rank: 6, title: "Schindler's List", year: 1993 },
  { rank: 7, title: "The Lord of the Rings: The Return of the King", year: 2003 },
  { rank: 8, title: "Pulp Fiction", year: 1994 },
  { rank: 9, title: "The Lord of the Rings: The Fellowship of the Ring", year: 2001 },
  { rank: 10, title: "The Good, the Bad and the Ugly", year: 1966 },
];

async function main() {
  const app = new App();

  // Request logger middleware
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.get("/", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<html><body><h1>Hello World</h1><p><a href="/movies/top">Top 10 Best Movies</a></p></body></html>'
    );
  });

  // Top 10 best movies page
  app.get("/movies/top", (_req, res) => {
    const rows = TOP_MOVIES.map(
      (m) =>
        `<tr><td>${m.rank}</td><td>${m.title}</td><td>${m.year}</td></tr>`
    ).join("");
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Top 10 Best Movies</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; }
      th { background: #f5f5f5; }
      td:first-child { width: 3rem; text-align: right; font-weight: 600; }
      td:last-child { width: 5rem; color: #666; }
    </style>
  </head>
  <body>
    <h1>Top 10 Best Movies</h1>
    <table>
      <thead><tr><th>#</th><th>Title</th><th>Year</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><a href="/">Home</a></p>
  </body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });

  // Path params + query string
  app.get("/users/:id", (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: req.params.id, query: req.query }));
  });

  // Sub-router mounted under /api
  const api = new Router();
  api.get("/health", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  api.get("/movies/top", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ movies: TOP_MOVIES }));
  });
  app.use("/api", api);

  // Error handler (4-arg middleware)
  app.use((err, _req, res, _next) => {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: (err as Error).message ?? String(err) }));
  });

  app.listen(8080, ({ port }) => {
    console.log(`HTTP Server listening on port ${port}`);
  });
}
main();
