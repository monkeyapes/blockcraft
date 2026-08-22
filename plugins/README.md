# Plugins

Drop a `.mjs` file in here and restart the server. No build step, no
dependencies, no manifest — one file that exports `register`.

```js
export function register(ctx) {
  ctx.command('spawn', 'go back to spawn', (player) => {
    ctx.tell(player.name, 'Not implemented yet, but the command is yours.');
  });

  ctx.on('join', (player) => {
    ctx.broadcast(`${player.name} joined ${ctx.serverName}`);
  });
}
```

## What `ctx` gives you

| | |
|---|---|
| `command(name, help, run)` | A chat command. First registration wins; a clash is logged. |
| `panel(id, build)` | A whole in-game screen. Return rows; the client lays them out. |
| `panelAction(id, run)` | What a button on your panel does. |
| `on(event, fn)` | `join`, `leave`, `chat`, `kill`, `tick`. |
| `tell(name, text)` | A private line to one player. |
| `broadcast(text)` | A line to everyone. |
| `players()` | Everyone connected, with positions. |
| `grant` / `take` | Move items in and out of an inventory. |
| `storagePath(file)` | Somewhere to keep data across restarts. |
| `serverName` | What the server calls itself. |
| `log(text)` | The server log, tagged with your plugin's name. |

A panel needs no client code. You send rows — a label, an optional item id
for the icon, a detail, and some action names — and the game draws them. That
is the difference between a plugin system and a patch.

## What this is not

**There is no sandbox.** Plugins run in the server process and can do
anything it can: read your files, open sockets, delete the world. Only install
plugins you would be willing to run as a script, because that is exactly what
they are.

Failures are contained, though. A plugin that throws while loading is skipped,
one that throws on an event does not stop the others, and one that throws in a
command tells the player and names itself in the log. A server that will not
boot because of one broken plugin is a server whose owner cannot get in to
remove the broken plugin.

## The economy is one of these

`economy` is registered through this same API rather than beside it. An
extension API that the project's own features bypass grows gaps exactly where
the interesting work is, because the interesting work never had to use it.
