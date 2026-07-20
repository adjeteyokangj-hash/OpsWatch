import { CONFIDENCE_LEVEL, MIN_BASELINE_SAMPLES_PHASE9 } from "./learning-flags";

export type SampleStats = {
  sampleCount: number;
  mean: number | null;
  median: number | null;
  p50: number | null;
  p95: number | null;
  variance: number | null;
  minValue: number | null;
  maxValue: number | null;
};

export const computeSampleStats = (values: number[]): SampleStats => {
  if (values.length === 0) {
    return {
      sampleCount: 0,
      mean: null,
      median: null,
      p50: null,
      p95: null,
      variance: null,
      minValue: null,
      maxValue: null
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mean = sum / sorted.length;
  const variance =
    sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sorted.length;
  const percentile = (p: number): number => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index]!;
  };
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  return {
    sampleCount: sorted.length,
    mean,
    median,
    p50: percentile(50),
    p95: percentile(95),
    variance,
    minValue: sorted[0]!,
    maxValue: sorted[sorted.length - 1]!
  };
};

export const confidenceFromSamples = (sampleCount: number, stability = 1): {
  score: number;
  label: string;
} => {
  if (sampleCount < MIN_BASELINE_SAMPLES_PHASE9) {
    return { score: Math.min(0.4, sampleCount / MIN_BASELINE_SAMPLES_PHASE9), label: CONFIDENCE_LEVEL.INSUFFICIENT };
  }
  const sizeScore = Math.min(1, sampleCount / (MIN_BASELINE_SAMPLES_PHASE9 * 4));
  const score = Math.max(0, Math.min(1, sizeScore * 0.7 + stability * 0.3));
  if (score >= 0.75) return { score, label: CONFIDENCE_LEVEL.HIGH };
  if (score >= 0.55) return { score, label: CONFIDENCE_LEVEL.MODERATE };
  return { score, label: CONFIDENCE_LEVEL.LOW };
};

export const isTestOrFixtureProject = (input: {
  slug?: string | null;
  name?: string | null;
  clientName?: string | null;
  environment?: string | null;
}): boolean => {
  const hay = [input.slug, input.name, input.clientName, input.environment]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    hay.includes("fixture") ||
    hay.includes("seeded") ||
    hay.includes("demo") ||
    hay.includes("smoke-") ||
    hay.includes("test-data") ||
    hay.includes("e2e-")
  );
};
