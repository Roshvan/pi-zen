# pi-zen

A calmer terminal interface for [Pi](https://pi.dev). Less visual clutter, compact tool activity, and room to follow along and steer the work.

Zen changes presentation—not model prompts, tool execution, or session data. Details stay available when you expand tool rows.

![Pi Zen coding demo](screenshots/pi-zen-coding-cat.gif)

## Install

```sh
pi install npm:pi-zen
```

Start Pi as usual. Zen is on by default.

- `/zen` toggles Zen.
- `/zen on` enables it.
- `/zen off` returns to Pi’s native interface.

Zen also quiets Pi’s startup screen. Turning Zen off restores startup settings that Zen changed.

## Development

```sh
pnpm install
pnpm dev
```

See the [repository guidelines](AGENTS.md) for verification requirements and [package scripts](package.json) for available commands.

## License

[MIT](LICENSE)
