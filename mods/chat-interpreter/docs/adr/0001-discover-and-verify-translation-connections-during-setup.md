# Discover and verify translation connections during setup

The person invokes `/chat-interpreter:setup` so the current session model can learn how to call their language model, translation API, or local CLI. It can consult provider documentation or the tool's help and use a request description for simple calls or generate a local adapter script for cases such as request signing or unusual CLI output. Ordinary translations reuse the verified call directly, which keeps protocol discovery and the setup model out of the per-message path.

Setup tests one short, synthetic example per distinct target language the person intends to enable, using the same invocation and result extraction that ordinary translations will use on the current surface. Input and output with the same target share a test. Saving a connection for later requires one sample. Setup shows each source and its extracted translation together for a single confirmation. A failed credential check returns to credential setup, while a response parsing failure calls for correcting the extraction.

## Credentials and endpoint discovery

Setup reuses available environment credentials. When new credentials are needed, it gives instructions for entering them outside the conversation into a local configuration readable only by the user, so the current session can continue. Verification reports availability and the sample translation. Keys stay out of conversation text, tool output, and generated scripts.

For private endpoints, discovery uses the provider name or a public documentation link. When public documentation is unavailable, setup can ask for a sanitized request example such as a curl command, or a path to sanitized local documentation. Examples use placeholders for credentials and private addresses. The trial request uses the locally configured endpoint.

## Connection scope and activation

One global translation connection serves both input and output across the user's projects. The plugin will retire the built-in DeepSeek connection without migrating it. A person who wants to continue using DeepSeek can connect it through setup.

Setup pauses automatic input and output translation in the interviewing session so a failed connection cannot block the conversation. Other sessions keep using the active connection during discovery and testing. Confirming the sample replaces the connection for subsequent requests across projects. Cancelling setup or failing a test leaves the previous connection available. The interviewing session resumes its configured translation behavior when setup ends.

Input and output target languages and translation switches belong to the active project or global settings scope. When confirming the sample, the person chooses whether to enable input translation, output translation, both, or save the connection for later. Setup identifies which scope will receive these preferences.

Saved translations remain associated with the conversation, message, and target language. Switching connections preserves existing translations. A subsequent request for an uncached translation uses the new connection.

## Languages

Setup suggests English as the input target and the language of the person's prompt as the output target. The person can request any target language. The source language is detected for each message. Local punctuation conversion applies the existing rules for Chinese and English and leaves punctuation intact for other target languages.
