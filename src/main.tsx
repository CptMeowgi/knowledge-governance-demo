import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Placeholder until the UI is built on top of the domain layer in src/domain.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>Knowledge Base 2.0</h1>
      <p>The governance rules live in src/domain. The interface comes next.</p>
    </main>
  </StrictMode>,
);
