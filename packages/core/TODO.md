# TODO

## HybridAdapter
Adapter który automatycznie przełącza między lokalnym LLM a cloud.
- primary: lokalny (Ollama, LM Studio)
- fallback: cloud (OpenAI, Groq, Anthropic)
- przełącza gdy confidence klasyfikacji < threshold lub gdy lokalny zawiedzie
- użytkownik dostaje prywatność gdzie się da, cloud gdzie musi

## Intent Points + Embeddings
Pomysł na poprawę klasyfikacji intencji:
- "punkty intencji" — predefiniowane przykłady dla każdej akcji
- embeddingi do porównania wiadomości użytkownika z punktami
- nie rozwiązuje hardcoded rozwiązań ale poprawia routing
- do przemyślenia jak połączyć z obecnym rule engine
