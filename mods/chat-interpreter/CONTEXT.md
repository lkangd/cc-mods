# Chat Interpreter

Chat Interpreter lets a person write in one language while Claude receives another, and read a translated final reply without changing Claude's stored reply.

## Language

**Input translation**:
The changed user prompt sent to Claude after a successful translation. The original input is the text the person submitted before this change.
_Avoid_: Prompt enhancement, rewrite

**Output translation**:
A translated presentation of the main agent's final answer. The original answer remains in the conversation Claude uses.
_Avoid_: Model response replacement

**Target language**:
The language requested for a translation. Input and output each have their own target language.
_Avoid_: Translation direction

**Translation setup**:
A guided conversation in which a person connects an existing translation service or local tool, chooses the input and output target languages, and confirms a sample translation before saving the connection for reuse.

**Translation connection**:
The saved way Chat Interpreter uses a person's translation service or local tool. One active connection serves input and output translation across that person's projects.

**Translation cache**:
Saved input and output translations associated with a conversation, a message, and a target language. A saved translation can be shown when the conversation is reopened.

**Manual translation control**:
The action below a final reply that requests a translation or toggles the visibility of one already saved.

**Punctuation conversion**:
A local substitution of punctuation marks outside protected technical text. It makes no translation service request.
_Avoid_: Translation

**Active scope**:
The selected set of scope-specific settings, either project or global. The two sets are independent. The translation connection applies across both.
_Avoid_: Override, precedence

**Protected text**:
Code fences, inline code, paths, and URLs that retain their exact characters during translation or punctuation conversion.
_Avoid_: Plain text
