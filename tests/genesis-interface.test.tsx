import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import GenesisInterface from "../src/app/scene/genesis/GenesisInterface";
import GenesisCore from "../src/app/scene/genesis/GenesisCore";

function renderInterface() {
  return renderToStaticMarkup(
    // Mounted the way App.tsx mounts it: inside a router (GenesisInterface navigates).
    <MemoryRouter>
    <GenesisCore>
      <GenesisInterface />
    </GenesisCore>
    </MemoryRouter>,
  );
}

test("GenesisInterface does not render the placeholder overlay UI", () => {
  const markup = renderInterface();

  assert.doesNotMatch(markup, /No conversation yet|Start the living loop/i);
});

test("GenesisInterface renders interactive controls for the living scene", () => {
  const markup = renderInterface();

  assert.match(markup, /Chat/i);
  assert.match(markup, /Core/i);
  assert.match(markup, /Memory/i);
  // Visual Studio is accessible through the side panel, not a separate dock destination.
});
