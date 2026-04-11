
export const ANALYZE_WITH_SYNAPSES_PROMPT = (
    deltaSummaries: string,
    contextSummaries: string
) => {
    return `Analyze new entries (isNew=true) and find connections to existing ones.

NEW ENTRIES (analyze these):
${deltaSummaries}

EXISTING ENTRIES (for context/connections):
${contextSummaries}

Return JSON with TWO arrays:
{
  "topics": [{"topic":"name","entryIds":["id1"],"tags":["tag"],"importance":1-10}],
  "synapses": [{"sourceId":"newEntryId","targetId":"anyEntryId","reason":"semantic reason why connected","strength":1-10}]
}

RULES for synapses:
- sourceId MUST be from NEW entries (isNew=true)
- targetId can be any entry (new or existing)
- reason should explain the semantic connection (e.g., "Both discuss investment strategies")
- strength: 1-3 weak, 4-6 moderate, 7-10 strong connection
- Max 3 synapses per new entry
- Only create meaningful connections, not everything

Only valid JSON, no text.`
}
