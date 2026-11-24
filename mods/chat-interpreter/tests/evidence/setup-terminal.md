# Guided setup on the terminal

On 2026-11-24, both scenarios passed on macOS with Claude Code 2.1.311, using plugin revision `e469249`. Each scenario installed the checkout from a local marketplace into a fresh temporary Claude configuration, then submitted `/chat-interpreter:setup` in the real terminal. A scripted loopback Messages server drove the interview.

| Route | Observed result |
| --- | --- |
| HTTP | Setup initially reported a missing credential. A separate process ran the helper named by the installed skill with a dummy credential. The same session saw it and extracted the French text from a nested JSON response. |
| CLI | The interview ran the local executable's `--help`. The plugin passed the target in an argument and sent text on stdin for the shared trial and both ordinary translations. |

The terminal showed “The window is open. → La fenêtre est ouverte.” with target `fr` and project scope before confirmation. For both routes, one sample sufficed for both directions. After confirmation, the model received “Fermez la porte.” for “Close the door.” and the terminal displayed “La porte est fermée.” for “The door is closed.” The session transcript kept the original reply. Each translator received exactly three calls. The dummy credential was absent from the Messages conversation and final terminal screen.

## Reproduce

From the repository root, use Python 3.10 or later with the packages in `mods/chat-toc/tests/acceptance/requirements.txt` and `claude` on PATH. The temporary host configurations use synthetic credentials and loopback servers.

```sh
python3 mods/chat-interpreter/tests/acceptance/setup.py
```

A single route can be selected with `--route HTTP` or `--route CLI`.
