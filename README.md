# PurpAmoLED+
You need **[Raincord](https://www.raincord.dev/)** installed on your device to get the themes work.

## Installation
1. Copy **[this](https://raw.githubusercontent.com/a35hie/PurpAmoLED-Plus/main/dist/theme.json)** link. 
2. Paste it in `Settings -> Themes -> +` to install the theme.

## Development
This theme uses a custom Sass-based DSL for optimal DX.
Themes are then compiled to JSON using a custom parser (`src/parser.ts`).

To get started:
- use Bun!
- `bun i`
- `bun run parse` to compile the theme.

### Dev Server
To get automatic theme generation, run `bun run dev`.
