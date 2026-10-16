# Decide how an earlier prompt is reused

Type: grilling
Status: open
Blocked by: 02

## Question

How does a person take an earlier User input back to send again or keep?

- Put it in the composer as a draft, copy it to the clipboard, or both; never submit it.
- What triggers it on an entry (a key on the selected entry, a control in the preview), on the terminal and on Desktop.
- What text is reused: the original as typed (with code blocks and pasted content restored) rather than the folded line on screen; what happens for a slash command, a `!cmd`, an image-only prompt; whether the Agent reply's last text can be copied too.
- What happens when the composer holds a draft or Claude is working, and what the person is told after it worked or failed.

Settled by the preview ticket (08): the preview shows the selected group while the Pane holds the keys (else the Current position's; on Desktop the last pressed), with the User input as typed under a `User` label row and the last text under an `Agent` label row; `p` and `e` are taken. A control in the preview acts on the group it shows.
