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

## Kategorie — zastąpić tagami ✅ DONE
- Hardcoded kategorie usunięte z całego frameworka (0.2.9)
- LTM grupuje po top shared tags zamiast kategorii
- TODO (opcjonalne): pozwolić użytkownikowi przekazać domain hints do analyze.prompt
  żeby model generował tagi specyficzne dla kontekstu (np. terminy prawne dla copyright-agenta)

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

## Własny model do klasyfikacji intencji
Mały model (1-3B) wytrenowany tylko na klasyfikacji intencji:
- wejście: tekst użytkownika
- wyjście: `{ "intent": "RESEARCH_BRAIN", "confidence": 0.92 }`
- deterministyczny, szybki, prywatny — zastępuje obecny hybrid routing

**Fine-tuning:**
- baza: llama3.2 3B lub phi-3 mini
- dane: ~1000 przykładów (intent → JSON)
- narzędzia: `unsloth` (2x szybszy fine-tuning), `llama.cpp` (konwersja do GGUF)
- koszt: kilka dolarów na RunPod/Colab

**Deploy:**
- Hugging Face Hub jako publiczne repo modelu
- użytkownik: `ollama pull greg00ry/the-brain-intent`
- framework automatycznie wykrywa i używa do klasyfikacji
- w przyszłości: `@the-brain/intent-model` — pakiet npm z `npx download`

**Dlaczego warto:**
- rozwiązuje problem zawodnej klasyfikacji lokalnych modeli
- użytkownik ma pełną prywatność (zero chmury)
- model można aktualizować niezależnie od frameworku

## Native Tool Calling (OpenAI function calling format)
Prawdziwe modele (GPT-4, Claude, Gemini) mają wbudowany tool calling:
- model sam decyduje kiedy wywołać tool
- dostaje wynik i może wywołać kolejny
- to jest natywny ReAct

Obecny problem z naszą implementacją:
- klasyfikacja intencji = osobny LLM call (nie natywny)
- handler hardcoded w frameworku, wynik nie wraca do modelu
- model nie "widzi" co się stało po akcji

Cel: przekazać actions jako "tools" w formacie OpenAI function calling:
- cloud (GPT-4, Claude): natywny tool calling działa od razu
- local (llama, deepseek): słabe wsparcie dla function calling — tutaj nasz hybrid routing jest wartością

To jest właśnie nasza przewaga: robimy żeby działało dobrze lokalnie tam gdzie cloud działa natywnie.
