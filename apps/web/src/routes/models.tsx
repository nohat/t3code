import { createFileRoute } from "@tanstack/react-router";

import { ModelsPage } from "../components/models/ModelsPage";

export const Route = createFileRoute("/models")({
  component: ModelsPage,
});
