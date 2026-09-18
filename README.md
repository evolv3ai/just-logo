<div align="center">

<img src="public/logo.svg" alt="Just Logo" width="100" />

<h1>Just Logo</h1>

<h3>A Multi-Source Logo Generator</h3>

[Website](https://just-logo.ahmedsemih.com/)

![Example](public/examples/example.png)

</div>

## ✨ Introduction

This is a simple tool that helps you create logos for your side projects using icons from multiple libraries.

I know there are many logo generator tools that work in similar ways, but I’m not aware of any that allow using multiple icon libraries at the same time. Most of these tools are typically based on a single library.

The live version currently uses icons from five different icon libraries. When running it locally, you can add more libraries or swap them out.

## 🚀 Features

- 📚 Multiple icon libraries:
  - [Lucide Icons](https://lucide.dev/icons/)
  - [Lucide Lab](https://lucide.dev/icons/)
  - [Tabler Icons](https://tabler-icons.io/)
  - [Meteor Icons](https://meteoricons.com/)
  - [HugeIcons](https://hugeicons.com/) (free icons only)
- 🎨 Customize colors, sizes, and layouts
- 💾 Export logos in **PNG** and **SVG** formats
- 🔄 History management with **undo/redo** functionality
- ⌨️ Keyboard shortcuts for faster editing
- ⚙️ Preset configurations for quick logo generation

## 🛠️ Built With

- [TanStack Start](https://tanstack.com/start/latest)
- [Tailwind CSS](https://tailwindcss.com/)
- [Shadcn UI](https://ui.shadcn.com/)
- [Iconify](https://iconify.design/)

## 🏁 Getting Started

To run this project locally, follow these steps:

### 📋 Prerequisites

- Node.js (>= 18)
- pnpm

### ⚙️ Installation & Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/ahmedsemih/just-logo.git
   ```

2. Navigate to the project directory:

   ```bash
   cd just-logo
   ```

3. Install dependencies:

   ```bash
   pnpm install
   ```

4. Run the icon generation script to generate icons-db.json file:

   ```bash
   pnpm generate:icons
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```

## 🤖 CLI (headless, agent-friendly)

Everything the editor does, from a terminal and without a browser: search the same five icon libraries, use the same presets, and export the same logo to SVG or PNG. Every command takes `--json` and prints exactly one JSON value, with exit codes `0` ok, `1` error, `2` usage error, so a coding agent can drive it end to end.

After `pnpm install`, run it as `pnpm logo <command>` (or `npx tsx cli/index.ts`). `pnpm link --global` makes it available as `just-logo`.

Two things to know when a program reads the output:

- **Use `pnpm --silent logo ... --json`, not `pnpm logo ... --json`.** Without `--silent`, pnpm prints a banner naming the script; pnpm 12 sends it to stderr, older versions to stdout ahead of the JSON. `--silent` removes it on every version. The linked `just-logo` command has no banner.
- **`pnpm logo` runs in the checkout's root**, so relative `--config` and `--out` paths resolve there. The `just-logo` command resolves them against the directory you are in.

| Command                                                       | What it does                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm logo icons sets`                                        | List the icon sets.                                                                                                                                                                   |
| `pnpm logo icons search <query> [--set <name>] [--limit <n>]` | Fuzzy-search icon names. Results carry an `id` like `lucide:rocket`.                                                                                                                  |
| `pnpm logo icons show <set:name>`                             | Print one icon's body and a bare SVG of it.                                                                                                                                           |
| `pnpm logo presets`                                           | List the presets and their colours.                                                                                                                                                   |
| `pnpm logo schema`                                            | Print the JSON schema of a render spec.                                                                                                                                               |
| `pnpm logo render [flags] [--config <file>]`                  | Render a logo. `--out <path>` (default `logo.<format>`; a `.png` extension or `--format png` selects PNG, `-` prints SVG to stdout). Flags override `--config`, including `--preset`. |

Render flags mirror the editor's settings: `--icon <set:name>` (required unless the `--config` file has an `icon`), `--preset <name>`, `--size`, `--rotate`, `--stroke-color`, `--stroke-width`, `--stroke-opacity`, `--fill-color`, `--fill-opacity`, `--background` (a colour, a CSS `linear-gradient(...)` or `radial-gradient(...)`), `--margin`, `--radius`, `--border-width`, `--border-color`, `--png-size` (default 512) and `--format svg|png`. Defaults are what the editor shows on first run: a white icon on black (its dark theme). Pass colours or a `--preset` for anything else.

### Example: an agent making a logo

```bash
# 1. find an icon
pnpm --silent logo icons search rocket --limit 3 --json
# [{"id":"lucide:rocket","set":"lucide","name":"rocket","score":0}, ...]

# 2. write a spec in the checkout's root (validate it against `pnpm --silent logo schema` if you like)
cat > logo.json <<'EOF'
{ "icon": "lucide:rocket", "preset": "Ocean Breeze", "size": 300, "radius": 96, "margin": 32 }
EOF

# 3. render it, overriding one value on the way
pnpm --silent logo render --config logo.json --rotate=-15 --out logo.png --json
# {"format":"png","out":"/abs/path/logo.png","bytes":...,"width":512,"height":512,"spec":{...}}
```

Errors are machine-readable too: `error: <what>` and `help: <a runnable fix>` on stderr, and the same object on stdout with `--json`. Exit 1 means an I/O or rendering problem (missing config file, unknown icon, output path not writable, rasteriser unavailable); exit 2 means the command line or the config content is wrong, and a bad flag is exit 2 whatever else is wrong. Every command rejects unknown flags. Colour values may not contain control characters.

The CLI reuses the editor's icon cleaning and presets and composes what the editor's preview shows: the same 512 canvas, background box and icon settings, as plain SVG. (The editor's own SVG download is an `html-to-image` snapshot wrapped in a `foreignObject`, so the two files are not alike inside.) Pixel-identical parity with the browser PNG is not a goal. Where the SVG is knowingly not what the browser draws, `--json` says so with `backgroundApproximated: true` (and the reasons in `backgroundApproximations`) and stderr carries one warning per reason: a radial gradient's shape, size and position are ignored (it is drawn centred) and its negative stop positions are clamped, a gradient is not repeated under a border whose colour is not opaque, and a gradient with a see-through stop blends differently in SVG than in CSS. `icons search` puts an exact name first.

## 📚 Using Other Icon Libraries

You can expand the icon selection by adding other icon libraries supported by [Iconify](https://icon-sets.iconify.design/).

1. Open `src/lib/constants.ts` file.
2. Modify the `AVAILABLE_ICON_SETS` array to include the names of the icon libraries you want to use.
3. Save the file and run the icon generation script again:
   ```bash
   pnpm generate:icons
   ```

## 🤝 Contributing

Contributions are welcome!

Feature requests and ideas should be discussed via issues first.

Pull requests are welcome for bug fixes and small, focused improvements.

## 💬 Feedback & Support

Your feedback is very important! If you like the project, a ⭐️ would make my day.

If you have any questions or suggestions feel free to open an issue.

## 📄 License

Distributed under the [MIT License](LICENSE)

---

Made by Ahmed Semih Erkan with ❤️
