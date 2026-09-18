# Spec — headless CLI for just-logo

Status: draft, P1. Owner: evolv3ai. Target repo: evolv3ai/just-logo (fork of ahmedsemih/just-logo).

## 1. Outcome

An agent, or a person in a terminal, can produce the same logos the web editor produces without a browser: search the icon libraries, list the presets, and render a logo to SVG or PNG from command-line flags or from a JSON spec file. Every command has a `--json` mode with a stable shape and exit codes, so a coding agent can drive the tool end to end, from "find me a rocket icon" to "write logo.png".

## 2. Non-goals

- No change to the web editor's behaviour or UI.
- No new icon libraries. The CLI uses the same five sets as the editor (`AVAILABLE_ICON_SETS`).
- No image formats beyond SVG and PNG.
- No network access at runtime. Icons come from the locally installed `@iconify/json`.

## 3. Shape

- `cli/` holds the implementation as TypeScript run with `tsx` (already a dev dependency): `cli/index.ts` (argument parsing, commands, exit codes), `cli/render.ts` (pure function: spec in, SVG string out), `cli/icons.ts` (load, search), `cli/spec.ts` (types, defaults, validation, JSON schema).
- `package.json` gains a `logo` script (`tsx cli/index.ts`) and a `bin` entry `just-logo` pointing at `cli/bin.mjs`, a two-line shim that spawns `tsx cli/index.ts` with the same arguments.
- Rendering is pure string composition. The output SVG mirrors what the editor's export zone contains: a 512x512 canvas, a background rect with the editor's background (solid colour or `linear-gradient(...)`), margin, corner radius and border, and the chosen icon centred with the editor's size, rotation, stroke and fill settings. `linear-gradient(<angle>deg, <color> <stop>%, ...)` is converted to an SVG `<linearGradient>`; any other background string is passed through as a fill and flagged in `--json` output as `backgroundPassthrough: true`.
- PNG output rasterises that SVG with `@resvg/resvg-js`, added as a dependency. It is imported lazily, so SVG rendering works even where the native module fails to load; a PNG request then exits 1 with a clear message.
- Defaults match the editor's initial state so an agent that passes only `--icon` gets a sensible logo.

## 4. Commands

| Command | Behaviour |
| --- | --- |
| `just-logo icons sets` | Print the five set names. |
| `just-logo icons search <query> [--set <name>] [--limit <n>]` | Fuzzy search icon names (fuse.js, same library the editor uses). Default limit 20. Each result: `set`, `name`, `id` (`set:name`). |
| `just-logo icons show <set:name>` | Print the icon body and a standalone SVG of the bare icon. |
| `just-logo presets` | Print preset names and their colours. |
| `just-logo schema` | Print the JSON schema of a render spec. |
| `just-logo render [flags] [--config <file>]` | Render to `--out <path>` (default `logo.svg`); `--out -` writes SVG to stdout. `--format svg|png` is inferred from the `--out` extension when omitted. `--config` takes a JSON spec; flags override config values. `--icon <set:name>` is required unless the config provides one. |

Render flags map one to one onto the editor's settings: `--icon`, `--preset`, `--size`, `--rotate`, `--stroke-color`, `--stroke-width`, `--stroke-opacity`, `--fill-color`, `--fill-opacity`, `--background`, `--margin`, `--radius`, `--border-width`, `--border-color`, plus `--png-size` (default 512).

Every command accepts `--json`. With it, stdout is exactly one JSON object and nothing else. Exit codes: 0 success, 1 operational error (bad file, missing icon, raster failure), 2 usage error (unknown flag, missing required value). Errors go to stderr as `error: <what>` followed by `help: <a runnable fix>`.

## 5. Acceptance criteria

Each criterion names how it is verified.

1. **AC1, search.** `just-logo icons search rocket --json` exits 0 and prints a JSON array whose first entries include an icon with `name` `rocket` from the `lucide` set. Verified by an integration test that spawns the CLI.
2. **AC2, unknown icon.** `just-logo render --icon lucide:no-such-icon --out -` exits 1 and stderr contains `error: icon not found` and a `help:` line. Verified by an integration test.
3. **AC3, SVG parity.** `just-logo render --icon lucide:rocket --preset "Ocean Breeze" --out -` exits 0 and stdout is a single `<svg>` document of width and height 512 containing one `<linearGradient>` with stops `#667eea` and `#764ba2`, a background `<rect>` with `rx` equal to the default radius, and one nested `<svg viewBox="0 0 24 24">` whose `color` attribute is the preset's stroke colour. Verified by a unit test on the render function and a snapshot test of the full document.
4. **AC4, gradient conversion.** The gradient parser maps `linear-gradient(135deg, #a 0%, #b 100%)` to a gradient whose x1,y1,x2,y2 correspond to 135 degrees, and maps a three-stop gradient to three stops with the given offsets. A non-gradient string is passed through untouched. Verified by unit tests with exact expected values.
5. **AC5, config file and override.** Given a JSON spec file with `icon: "tabler:heart"` and `size: 200`, `just-logo render --config spec.json --size 300 --out -` renders the tabler heart at size 300. Verified by an integration test that parses the output SVG.
6. **AC6, PNG.** `just-logo render --icon lucide:rocket --out logo.png` writes a file that starts with the PNG signature bytes and is 512x512; `--png-size 1024` yields 1024x1024. Verified by an integration test reading the IHDR chunk.
7. **AC7, JSON contract.** With `--json`, every command's stdout parses as exactly one JSON value and contains no other text, on success and on error (errors put `{"error": ..., "help": ...}` on stdout as well as stderr). Verified by an integration test that runs each command with `--json` and `JSON.parse`s stdout.
8. **AC8, schema.** `just-logo schema` prints a JSON schema, and every default spec value validates against it. Verified by a unit test.
9. **AC9, editor untouched.** `pnpm build` still succeeds and the existing vitest suite still passes. Verified by running both in the gate.
10. **AC10, documented.** README gains a "CLI" section listing every command and one worked example for an agent (search, then render from a JSON spec). Verified by review.

## 6. Risks

- Icon bodies from some sets use `fill="currentColor"` rather than strokes; the editor strips `fill`/`stroke-width` attributes with `getCleanIconBody` and re-applies them from settings. The CLI must reuse that exact function so parity holds.
- `@resvg/resvg-js` ships native binaries; on an unsupported platform SVG still works (see §3). The gate runs on macOS arm64 where it is supported.
- The web editor exports via `html-to-image`, which rasterises the DOM. Pixel-identical parity with the web PNG is not claimed; structural parity of the SVG is.
