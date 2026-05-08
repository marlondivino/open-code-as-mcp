# Antigravity Global Rules

1. **Prompt Refinement**: Whenever the user sends a request, first announce to the user: _"Refining your request with OpenCode for technical precision..."_, then use `opencode:refine_prompt`.
2. **Context Enrichment**: Upon receiving the refined prompt, validate if there are technical terms or project patterns that require additional lookup in semantic memory. Mention if you are pulling specific context from OpenCode memory.
3. **Continuous Learning**: After successfully implementing a complex feature, use `opencode:learn_context`. Briefly inform the user that this knowledge is being persisted in OpenCode's semantic memory.

---
**Global File Location**: `%USERPROFILE%\.gemini\GEMINI.md`
**Environment Variable**: `ANTIGRAVITY_RULES_PATH`
