/**
 * The "hello figma!" UI. Demonstrates the whole typed bridge in one screen:
 *
 * - `bridge.call("createRectangles", …)` — a typed request→reply RPC to the sandbox.
 * - `useSignal(selectionCount)` — live state PUSHED from the sandbox as a
 *   `selectionChanged` event, projected through `eventSignal` into a React value.
 *
 * Note there is no `postMessage`, no `msg.type` switch, no manual wiring — the
 * bridge and contract carry the types across the thread boundary.
 */

import { type JSX, useState } from "react";
import { createUiBridge } from "../ipc/channel.ui.js";
import { useSignal } from "../ipc/react.js";
import { eventSignal } from "../ipc/signals.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";
import "./App.css";

// One bridge for the app's lifetime. Created at module scope so the signal below
// is stable across renders.
const bridge = createUiBridge();

// Live selection count, pushed from the sandbox. Seeded at 0, updated on every
// `selectionChanged` event.
const selectionCount = eventSignal(
  bridge,
  "selectionChanged",
  (payload) => payload.count,
  0
);

export const App = (): JSX.Element => {
  const [count, setCount] = useState(5);
  const [creating, setCreating] = useState(false);
  const selected = useSignal(selectionCount);

  const onCreate = async (): Promise<void> => {
    setCreating(true);
    try {
      await bridge.call("createRectangles", { count });
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="app">
      <h2 className="app__title">Hello Figma! 👋</h2>
      <p className="app__hint">
        Create orange rectangles on the canvas. The count below updates live as
        your selection changes.
      </p>

      <label className="app__field">
        <span>Rectangle count</span>
        <Input
          type="number"
          min={0}
          value={count}
          onChange={(event) => setCount(Number(event.target.value) || 0)}
        />
      </label>

      <p className="app__selection">
        Selected on canvas: <strong>{selected}</strong>
      </p>

      <footer className="app__actions">
        <Button
          variant="brand"
          onClick={() => void onCreate()}
          disabled={creating}
        >
          {creating ? "Creating…" : "Create"}
        </Button>
        <Button onClick={() => void bridge.call("close")}>Close</Button>
      </footer>
    </main>
  );
};
