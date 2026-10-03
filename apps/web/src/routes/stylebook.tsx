import { createFileRoute } from "@tanstack/react-router";

import { StylebookPage } from "../components/stylebook/StylebookPage";

/**
 * Dev-only design-system gallery. Registered in every build so the route tree
 * stays deterministic, but it renders nothing outside development. Excluding it
 * from production bundles is a follow-up (see docs/fork/design-system.md).
 */
export const Route = createFileRoute("/stylebook")({
  component: StylebookRoute,
});

function StylebookRoute() {
  if (!import.meta.env.DEV) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        The stylebook is only available in development.
      </div>
    );
  }
  return <StylebookPage />;
}
