/**
 * Shared presentation constants for the model catalog.
 *
 * Methodology versions and weights are contract constants; the dashboard reads
 * them from here and displays them. Family order and labels are display-only.
 */
import {
  ADOPTION_METHODOLOGY_VERSION,
  BLEND_METHODOLOGY_VERSION,
  CAPABILITY_METHODOLOGY_VERSION,
  DEFAULT_BLEND,
  MODEL_CATALOG_METHODOLOGY,
  PUBLICATION_RULES,
  SPECIALIZATION_METHODOLOGY_VERSION,
} from "@t3tools/contracts";
import type { BenchmarkFamily } from "@t3tools/contracts";

export {
  ADOPTION_METHODOLOGY_VERSION,
  BLEND_METHODOLOGY_VERSION,
  CAPABILITY_METHODOLOGY_VERSION,
  DEFAULT_BLEND,
  MODEL_CATALOG_METHODOLOGY,
  PUBLICATION_RULES,
  SPECIALIZATION_METHODOLOGY_VERSION,
};

export const BENCHMARK_FAMILY_ORDER: readonly BenchmarkFamily[] = [
  "generalReasoning",
  "coding",
  "agenticCoding",
  "instructionFollowing",
  "mathScience",
  "longContext",
  "frontend",
  "visualDesign",
  "threeD",
  "spatialReasoning",
];

export const BENCHMARK_FAMILY_LABELS: Record<BenchmarkFamily, string> = {
  generalReasoning: "Reasoning",
  coding: "Coding",
  agenticCoding: "Agentic coding",
  instructionFollowing: "Instruction following",
  mathScience: "Math & science",
  longContext: "Long context",
  frontend: "Frontend",
  visualDesign: "Visual design",
  threeD: "3D",
  spatialReasoning: "Spatial reasoning",
};
