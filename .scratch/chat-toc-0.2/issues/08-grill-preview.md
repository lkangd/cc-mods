# Decide what the preview shows and how it opens

Type: grilling
Status: open
Blocked by: 05, 06

## Question

How does a person read a whole Turn group without jumping (and on Desktop, where jumping is refused, at all)?

- What opens it (pressing an entry still jumps on the terminal; so a key, a second press, a separate control?), and what closes it.
- What it holds: the full User input, the Agent reply's last text as Markdown, the state, steps, the files the turn touched, duration and tokens; what is left out when a field cannot be read.
- How long text scrolls inside it, and how it follows when the selected group changes or a running turn grows.
- Whether the Minimap can switch its bar height from steps to tokens (or duration), and where that switch lives.
- The words on screen in both languages, and the glossary term.

Settled by the layout ticket (06): the preview is a bottom region above the footer that follows the Current position (on Desktop, the last entry clicked), `p` shows or hides it, and it shrinks to 4 rows and then leaves when rows run short. Still open here: what it holds and what goes first inside it at 4–5 rows, how it scrolls, and whether its size rule (40%, 4–14 rows in the prototype) stands.
