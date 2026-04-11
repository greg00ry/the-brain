export const RESEARCH_ANSWER_PROMPT = (
  userText: string,
  context: string,
  chatHistory?: { role: string; content: string }[],
): string => {
  let history = '';
  if (chatHistory && chatHistory.length > 0) {
    history = '\nCONVERSATION HISTORY:\n' +
      chatHistory.slice(-5).map(m => `${m.role === 'user' ? 'User' : 'Brain'}: ${m.content}`).join('\n') +
      '\n';
  }

  return `Answer the user's question using ONLY the information from the memory context below.
Do NOT use any outside knowledge. If the context does not contain the answer, say exactly: "Nie mam tej informacji w pamięci."
Do NOT invent article numbers, laws, or facts that are not explicitly present in the context.
${history}
MEMORY CONTEXT:
${context}

USER: ${userText}`;
};
