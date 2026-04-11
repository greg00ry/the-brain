
export const LONG_TERM_MEMORY_SUMMARY_PROMPT = (topic: string, entriesContent: string) => {
    return `Consolidate these memories about "${topic}" into one summary.

Entries:
${entriesContent}

Return JSON: {"summary":"max 300 words","tags":["tag1","tag2"]}

Only valid JSON.`;
}
