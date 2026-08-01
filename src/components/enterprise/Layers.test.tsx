import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";

import Dialog from "./Dialog";
import Drawer from "./Drawer";

afterEach(cleanup);

it.each([
  ["dialog", Dialog],
  ["drawer", Drawer],
] as const)("%s moves focus inside, traps Tab, closes on Escape and restores focus", (_name, Layer) => {
  const close = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return <div>
      <button type="button" onClick={() => setOpen(true)}>opener</button>
      <Layer open={open} title="details" onClose={() => { close(); setOpen(false); }} footer={<button type="button">save</button>}>
        <input aria-label="first field" />
      </Layer>
    </div>;
  }
  render(<Harness />);

  const opener = screen.getByRole("button", { name: "opener" });
  opener.focus();
  fireEvent.click(opener);
  const layer = screen.getByRole("dialog", { name: "details" });
  expect(layer).toContainElement(document.activeElement as HTMLElement);
  fireEvent.keyDown(layer, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "save" })).toHaveFocus();
  fireEvent.keyDown(layer, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  expect(opener).toHaveFocus();
});
