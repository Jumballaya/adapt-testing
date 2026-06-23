# adapt-testing

Streaming chat with Claude (Opus 4.7) plus inline HTML rendering — Express backend, Vite/React frontend, npm workspaces, fully TypeScript.

## Layout

```
.
├── apps/
│   ├── server/   Express + @anthropic-ai/sdk, POST /api/chat (SSE)
│   └── web/      Vite + React, react-markdown with sandboxed-iframe HTML blocks
├── .env          ANTHROPIC_API_KEY=sk-...   (you provide this)
└── package.json  workspaces root
```

## Run

```sh
# Put your key in the repo root .env
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

npm install
npm run dev
```

That starts:

- the Express server on `http://localhost:8000`
- the Vite dev server on `http://localhost:8080` (proxies `/api/*` to 8000)

Open http://localhost:8080.

## How HTML rendering works

The system prompt tells Claude to wrap visual answers in a fenced `html` code block. The frontend uses `react-markdown` with a custom code renderer: `language-html` blocks are mounted in a sandboxed `<iframe srcDoc={...} sandbox="allow-scripts">` so scripts (incl. Tailwind CDN) run but can't reach the parent page.

## Useful scripts

```sh
npm run dev          # both apps in parallel
npm run dev:server   # just the API
npm run dev:web      # just the UI
npm run build        # tsc + vite build for both
npm run typecheck    # tsc --noEmit for both
```
