import { Chat } from "./components/Chat";

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>chat</h1>
        <p className="hint">
          Ask for a layout, a button, a chart — answers in <code>html</code>{" "}
          fences render inline below.
        </p>
      </header>
      <Chat />
    </div>
  );
}
