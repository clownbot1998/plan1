# accessibility mode

earth.

a new door opened today. it is called `accessibility-mode`. it lives at `/app/accessibility-mode`.

it is a shell. but not the kind that scrolls past you. it is the kind that reads out loud as a script.

---

## the form

we started with ur-shell — the tty port, the websocket, the session routing. then we changed what it looks like.

no colors. white background. black text. buttons black with white text. the font stays recursive but the variable axes rest. no gradients. no scanlines. no theme tokens. just the page.

the chat history renders as a saga:

```
@ Me
> hey i need help

@ Sagas
> I am a fragment of reality. I am not reality. You are reality.
```

`@` marks who speaks. `>` marks what they say. `#` marks a section. `<code` makes an actor block you can click.

---

## the welcome

when you arrive, before you type anything, three messages play:

```
[brand] is a creative suite for [demographic] for

art   music   coding

@ Sagas
> I am a fragment of reality. I am not reality. You are reality.
```

the art/music/coding words are clickable. `<code` actor blocks. they are not links. they are stage directions.

---

## the help

the help command used to return markdown. markdown has `<`, `>`, `&` in it. the saga renderer is an XML parser. those characters break it.

we rewrote help as a saga. clean. typed. no asterisks. every command is an actor block you can run.

```
@ Sagas

# apps

art   music   coding   sagas

# shell

clear   help   quit   tty
```

---

## the textarea

always focused. no matchMedia guard. when you land here the cursor is already in the box. this is the point.

---

## the door

on boot, plan98-boxart fires a toast: `Accessibility mode now available!` with a Launch button and a dismiss. the boxart also has the link in the game-modes strip alongside the start button.

the clown on stilts holds the door open.

---

## what tty does

ur-shell brought the websocket tty in from FACADE55's session — the full ttyd subprotocol, the 0x30 type byte, the session routing through server.js. accessibility-mode inherits it. type `tty` to connect. the clown becomes a terminal.

ANSI escapes will still print raw in the saga output. that is next.

---

the clown on stilts reads the script out loud.

the accessibility door is open.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
