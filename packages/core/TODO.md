# TODO

## HybridAdapter
Adapter który automatycznie przełącza między lokalnym LLM a cloud.
- primary: lokalny (Ollama, LM Studio)
- fallback: cloud (OpenAI, Groq, Anthropic)
- przełącza gdy confidence klasyfikacji < threshold lub gdy lokalny zawiedzie
- użytkownik dostaje prywatność gdzie się da, cloud gdzie musi

## Znane błędy do naprawy
- Warning w konsoli gdy brak embedding adaptera (zamiast cichego fallbacku na keyword search)
- Retrieval używa `summary` zamiast `rawText` w kontekście — model halucynuje artykuły
- Klasyfikacja intencji zawodna bez embeddingów
- Przetestować `builtInActions` override w praktyce

## Intent Points + Embeddings
Pomysł na poprawę klasyfikacji intencji:
- "punkty intencji" — predefiniowane przykłady dla każdej akcji
- embeddingi do porównania wiadomości użytkownika z punktami
- nie rozwiązuje hardcoded rozwiązań ale poprawia routing
- do przemyślenia jak połączyć z obecnym rule engine

## Kategorie — zastąpić tagami
- Obecna lista hardcoded (`Work`, `Personal`, `Health`...) nie skaluje się dla custom agentów
- Model przypisuje kategorię przy ingeście, LTM grupowane po kategorii w conscious.processor
- Pomysł: zastąpić kategorię wolnymi tagami generowanymi przez model (np. `["prawo autorskie", "licencje", "dozwolony użytek"]`)
- Wymaga zmiany: `analyze.service.ts`, `analyze.prompt.ts`, `conscious.processor.ts`, `types/brain.ts`

## ReAct agentic loop
Obecny model: 1 wiadomość → klasyfikacja → 1 akcja → odpowiedź. Brak chainowania.

Cel: pętla Reason → Act → Observe → Reason → ... → odpowiedź końcowa.

Przykład workflow:
- "znajdź coś o prawach autorskich i zapisz" → SAVE_SEARCH → obserwuje wynik → SAVE_ONLY → done
- "sprawdź czy mam coś o X, jeśli nie to wyszukaj" → RESEARCH_BRAIN → brak → SAVE_SEARCH → done

Pomysł implementacji:
- `brain.run(userId, text)` zamiast `brain.process()` — uruchamia pętlę ReAct
- każda akcja zwraca `{ result, done: boolean, nextHint? }` zamiast tylko stringa
- max N iteracji (zabezpieczenie przed infinite loop)
- historia kroków widoczna w odpowiedzi końcowej

Multi-agent:
- każdy agent = Brain z innym systemPrompt + innymi akcjami
- orchestrator (też Brain) routuje do właściwego agenta
- agenci mogą wywoływać innych agentów przez akcje
- do przemyślenia: jak przekazywać kontekst między agentami
