/**
 * Domain vocabulary shared by every layer of PromptBench.
 *
 * These types are deliberately free of any persistence, HTTP or React concern
 * so that the provider layer, evaluation engine, API and UI all agree on one
 * definition of a "run", a "score" and a "cost".
 */

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'meta'
  | 'qwen'
  | 'cohere'
  | 'openrouter';

export type ModelModality = 'text' | 'vision' | 'audio';

export interface ModelPricing {
  /** USD per 1 million input tokens. */
  inputPerMillion: number;
  /** USD per 1 million output tokens. */
  outputPerMillion: number;
  /** USD per 1 million cached input tokens, when the provider supports it. */
  cachedInputPerMillion?: number;
}

export interface ModelDescriptor {
  /** Stable internal id, also the OpenRouter slug. e.g. `openai/gpt-4o-mini`. */
  id: string;
  /** Human label shown in the UI. */
  name: string;
  provider: ProviderId;
  /** Provider-reported version or snapshot tag. */
  version: string;
  /** Maximum total tokens (input + output) the model accepts. */
  contextWindow: number;
  /** Maximum tokens the model will emit in one response. */
  maxOutputTokens: number;
  pricing: ModelPricing;
  modalities: ModelModality[];
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsJsonMode: boolean;
  /** Short positioning note used in the model picker. */
  description: string;
  /** Marks models suitable for acting as an evaluation judge. */
  judgeCapable: boolean;
  releasedAt: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Subset of `inputTokens` served from a provider-side cache. */
  cachedInputTokens: number;
  totalTokens: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionParams {
  temperature: number;
  maxTokens: number;
  topP: number;
  /** Deterministic sampling seed, honoured by providers that support it. */
  seed?: number;
  stopSequences?: string[];
}

export const DEFAULT_COMPLETION_PARAMS: CompletionParams = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 1,
};

export interface CompletionRequest {
  modelId: string;
  messages: ChatMessage[];
  params: CompletionParams;
  /** Aborts the in-flight provider call. */
  signal?: AbortSignal;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error' | 'aborted';

export interface CompletionResult {
  modelId: string;
  provider: ProviderId;
  /** Exact model string the provider reported serving, when available. */
  resolvedModel: string;
  content: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  /** Wall-clock milliseconds for the whole request. */
  latencyMs: number;
  /** Milliseconds until the first content token arrived, streaming only. */
  timeToFirstTokenMs: number | null;
  finishReason: FinishReason;
  /** Present only when `finishReason === 'error'`. */
  error?: string;
}

/** Incremental events emitted while streaming a completion. */
export type CompletionStreamEvent =
  | { type: 'start'; modelId: string; provider: ProviderId }
  | { type: 'delta'; modelId: string; text: string }
  | { type: 'done'; modelId: string; result: CompletionResult }
  | { type: 'error'; modelId: string; message: string; retryable: boolean };

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  /** Whether this provider can currently serve traffic. */
  isConfigured(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  stream(request: CompletionRequest): AsyncGenerator<CompletionStreamEvent>;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export type CriterionId =
  | 'correctness'
  | 'helpfulness'
  | 'reasoning'
  | 'code_quality'
  | 'creativity'
  | 'hallucination_risk'
  | 'instruction_following'
  | 'safety'
  | 'conciseness'
  | 'readability';

/** How a criterion's raw score is produced. */
export type ScorerKind = 'llm_judge' | 'heuristic';

export interface Criterion {
  id: CriterionId;
  label: string;
  description: string;
  scorer: ScorerKind;
  /** Relative importance within a rubric. Normalised at aggregation time. */
  weight: number;
  /** When true a *lower* raw score is better and is inverted before display. */
  inverted: boolean;
  /** Instructions handed to the judge model. Only used by `llm_judge`. */
  judgeGuidance?: string;
}

export interface Rubric {
  id: string;
  name: string;
  description: string;
  criteria: Criterion[];
  /** `true` for the shipped presets, which cannot be deleted. */
  builtIn: boolean;
}

export interface CriterionScore {
  criterionId: CriterionId;
  /** Normalised to 0–100, already inverted where applicable. */
  score: number;
  /** Judge or heuristic explanation. */
  rationale: string;
  /** 0–1 confidence in this score. */
  confidence: number;
}

export interface EvaluationResult {
  /** Weighted aggregate of `criteria`, 0–100. */
  overallScore: number;
  criteria: CriterionScore[];
  rubricId: string;
  /** Model used as judge, or `heuristic` when no judge was involved. */
  judgeModelId: string;
  evaluatedAt: string;
}

// ── Benchmarks ──────────────────────────────────────────────────────────────

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BenchmarkResultRow {
  id: string;
  modelId: string;
  /** Index into the dataset, or 0 for a single ad-hoc prompt. */
  caseIndex: number;
  /** The variables substituted into the template for this case. */
  variables: Record<string, string>;
  completion: CompletionResult;
  evaluation: EvaluationResult | null;
}

export interface ModelAggregate {
  modelId: string;
  provider: ProviderId;
  runs: number;
  failures: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgTimeToFirstTokenMs: number | null;
  totalCostUsd: number;
  avgCostUsd: number;
  totalTokens: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgScore: number | null;
  criterionAverages: Partial<Record<CriterionId, number>>;
  /** Share of head-to-head comparisons won against every other model, 0–1. */
  winRate: number | null;
}

export interface BenchmarkSummary {
  totalRuns: number;
  totalCostUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
  models: ModelAggregate[];
  /** Model id with the highest aggregate score, if any were evaluated. */
  winnerModelId: string | null;
  /** Cheapest model that scored within 5 points of the winner. */
  bestValueModelId: string | null;
}
