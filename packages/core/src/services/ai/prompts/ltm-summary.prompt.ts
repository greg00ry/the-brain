export const LONG_TERM_MEMORY_SUMMARY_PROMPT = (topic: string, entriesContent: string) => {
    return `Consolidate these memories about "${topic}" into one summary.

Entries:
${entriesContent}

Return JSON: {"summary":"max 300 words"}

Only valid JSON.`;
}
