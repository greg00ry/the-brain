export const ANALYZE_PROMPT = (text: string) => {
    return `Analyze the following text and return a JSON object with these exact fields:
        - summary: A concise summary (max 100 words)
        - strength: A number from 1-10 indicating how important/memorable this information is (1=trivial, 10=critical)

        Text to analyze:
        """
        ${text}
        """

        Return ONLY valid JSON, no additional text.`
}
