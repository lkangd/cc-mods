# Chat Interpreter

Chat Interpreter lets a person write in one language while Claude receives another, and read a translated final reply without changing Claude's stored reply.

## Language

**Input translation**:
The changed user prompt sent to Claude after a successful translation. The original input is the text the person submitted before this change.
_Avoid_: Prompt enhancement, rewrite

**Output translation**:
A translated presentation of the main agent's final answer. The original answer remains in the conversation Claude uses.
_Avoid_: Model response replacement

**Punctuation conversion**:
A local substitution of punctuation marks outside protected technical text. It makes no translation service request.
_Avoid_: Translation

**Active scope**:
The one settings set that currently governs Chat Interpreter: project or global. The two sets are independent and do not inherit from each other.
_Avoid_: Override, precedence

**Protected text**:
Code fences, inline code, paths, and URLs that retain their exact characters during translation or punctuation conversion.
_Avoid_: Plain text
