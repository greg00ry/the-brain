// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS - Single source of truth for all magic numbers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── LLM ─────────────────────────────────────────────────────────────────────

export const LLM = {
  API_URL: process.env.LLM_API_URL ?? "http://localhost:11434/v1/chat/completions",
  MODEL: process.env.LLM_MODEL ?? "llama3.2",
  TIMEOUT: Number(process.env.LLM_TIMEOUT ?? 120_000),

  // Intent classification
  INTENT_TEMPERATURE: 0.2,
  INTENT_MAX_TOKENS: 500,

  // Text analysis (analyzeTextWithAI)
  TEXT_ANALYZE_TEMPERATURE: 0.7,
  TEXT_ANALYZE_MAX_TOKENS: 500,

  // Brain analysis (conscious processor - analyzeWithSynapses)
  ANALYSIS_TEMPERATURE: 0.1,
  ANALYSIS_MAX_TOKENS: 3000,

  // Conversational response (RESEARCH_BRAIN handler)
  RESPONSE_TEMPERATURE: 0.7,
  RESPONSE_MAX_TOKENS: 1500,

  // Save acknowledgement (SAVE_ONLY handler)
  SAVE_TEMPERATURE: 0.8,
  SAVE_MAX_TOKENS: 300,

} as const;

// ─── Brain Processing ─────────────────────────────────────────────────────────

export const BRAIN = {
  // Conscious processor
  BATCH_SIZE: 5,
  DELTA_WINDOW_MS: 24 * 60 * 60 * 1000, // 24h

  // Strength thresholds
  STRENGTH_CONTEXT_MIN: 3,         // min strength for context entries
  STRENGTH_DECAY_PRUNE: 0,         // entries at this are pruned

  // Synapse thresholds
  SYNAPSE_PRUNE_WEIGHT: 0.1,       // synapses below this are pruned

  // Decay window — entries inactive longer than this lose strength
  DECAY_WINDOW_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const;

// ─── Memory / Retrieval ───────────────────────────────────────────────────────

export const MEMORY = {
  // Synaptic tree (intent.context.service)
  SYNAPSE_TREE_DEPTH: 5,
  SYNAPSE_BRANCH_FACTOR: 5,
  CONTEXT_TOP_ENTRIES: 5,
  CONTEXT_MAX_CHARS_PER_ENTRY: 1200,
  RAW_TEXT_PREVIEW_LENGTH: 80,
  MULTI_QUERY_MAX_TERMS: 3,   // max keywords queried independently in multi-query recall

  // Vault repo limits
  DELTA_ENTRIES_LIMIT: 50,
  CONTEXT_ENTRIES_LIMIT: 20,

  // Context prompt
  BRAIN_CONTEXT_MAX_CHARS: 400,
} as const;

// ─── Routing ──────────────────────────────────────────────────────────────────

export const ROUTING = {
  RULE_HIGH_CONFIDENCE: 90,  // rules above this skip LLM entirely
  LLM_MIN_CONFIDENCE: 75,    // LLM results below this trigger rule fallback
} as const;

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const CHAT = {
  HISTORY_LIMIT_FOR_LLM: 5,        // messages sent to LLM
  HISTORY_RECENT_FOR_PROMPT: 3,    // messages included in prompt
  HISTORY_MAX_STORED: 10,          // sliding window in DB
  MAINTENANCE_EVERY_N: 20,         // trigger maintenance every N saves
  PROFILE_UPDATE_EVERY_N: 10,      // update user profile every N conversations
} as const;

// ─── Misc ─────────────────────────────────────────────────────────────────────

export const MISC = {
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
} as const;
