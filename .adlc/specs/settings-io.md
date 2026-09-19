# Spec — settings export and import in the editor

Status: draft, P1. Owner: evolv3ai. Target repo: evolv3ai/just-logo (fork of ahmedsemih/just-logo).

## 1. Outcome

A design made in the web editor can be saved as a JSON file and rendered by the CLI, and a CLI spec file can be opened in the editor. The file is the CLI's render spec (`LogoSpec`, see `.adlc/specs/cli.md`): what **Export settings** writes is accepted unchanged by `just-logo render --config <file>`, and what **Import settings** reads is validated by the CLI's own `validateSpec`, so the editor and the CLI can never disagree about what a valid file is.

## 2. Non-goals

- No named saves, share links, cloud storage or multiple designs per browser. Autosave to `localStorage` stays as it is.
- No change to the CLI's commands, flags, output or exit codes.
- No drag-and-drop import; the file picker is the only way in.
- No new spec fields. The editor has no PNG size option, so `pngSize` is not written on export.

## 3. Shape

- `src/lib/logo-spec.ts` becomes the home of the spec contract (`LogoSpec`, `DEFAULT_SPEC`, `NUMBER_RULES`, `validateSpec`, `specSchema`, `presetValues`, `resolveSpec`, `layerSpec` and the constants beside them), moved verbatim from `cli/spec.ts`. It imports only `@/lib/constants` and nothing from Node, so browser code can import it. `cli/spec.ts` becomes a re-export of that module, so every CLI import and test keeps working unchanged.
- `src/lib/settings-io.ts` is a pure module (no React, no DOM) with the whole editor↔spec mapping:
  - `editorToSpec(iconSettings, backgroundSettings)` returns `{ ok: true, spec }` or `{ ok: false, message }`. The spec's `icon` is `<set>:<name>` from the editor's `IconItem`; `borderRadius` is written as `radius`; every other field keeps its name and value. `preset` and `pngSize` are not written. It refuses when no icon is chosen, and it runs `validateSpec` over its own result and refuses with the validator's message if that fails, so an exported file is always a valid `--config` file.
  - `specToEditor(spec, icons)` returns `{ ok: true, iconSettings, backgroundSettings }` or `{ ok: false, message }`. It looks the icon id up in the editor's icon list (the `IconItem[]` that `useIcons` loads from `public/icons-db.json`) and refuses an id that is not there, naming it.
  - `parseSettings(text, icons)` is the import path: `JSON.parse`, then `validateSpec`, then `resolveSpec` (so a `preset` is applied exactly as the CLI applies it: defaults, then preset, then explicit values; and missing fields take the CLI defaults), then `specToEditor`. `pngSize` is validated and then dropped. Validation failures return every validator error as `<path>: <message>`, joined with `; `, prefixed `invalid settings:`. Text that is not JSON returns `not a JSON file`.
  - `serializeSettings(spec)` returns the file text: two-space indented JSON with a trailing newline.
  - `MAX_SETTINGS_BYTES` (65536) bounds what the UI will read.
- `src/components/editor/editor-header/settings-menu.tsx` adds two outline icon buttons with tooltips, in their own separator group after Randomize and Clear in the header, matching the existing buttons: **Export settings** (hotkey `J`) downloads `logo.json`; **Import settings** (hotkey `I`) opens a hidden `<input type="file" accept="application/json,.json">`. Import refuses a file larger than `MAX_SETTINGS_BYTES` before reading it, and says so if the icon list has not loaded yet. Success and every refusal are shown with the existing `sonner` toast. A successful import calls `updateIconSettings` and `updateBackgroundSettings` with the full mapped state, so autosave and the undo history pick it up the same way they pick up Randomize. A refused import calls neither.
- Export reads the stored settings from `useEditor`, never the DOM, so the mobile preview's halved `size` and `strokeWidth` (display only, `previewer.tsx`) cannot leak into the file.

## 4. Acceptance criteria

Each criterion names how it is verified.

1. **AC1, export mapping.** `editorToSpec` on a full editor state returns a spec with `icon` equal to `<set>:<name>`, `radius` equal to the editor's `borderRadius`, all eleven other values equal to the editor's, and no `preset`, `pngSize`, `borderRadius` or `body` key. Verified by a unit test with exact expected output.
2. **AC2, exported file is a valid config.** For that state, `validateSpec(JSON.parse(serializeSettings(spec)))` returns no errors, and `just-logo render --config <that file> --out - --json` exits 0 with a `spec` whose values equal the exported ones. Verified by a unit test and an integration test that spawns the CLI.
3. **AC3, export refusals.** `editorToSpec` with `icon: null` returns `ok: false` with a message telling the user to pick an icon; with an out-of-range value (`size: 9999`) it returns `ok: false` carrying the validator's message. Verified by unit tests.
4. **AC4, import mapping.** `parseSettings` on a full spec file returns editor settings whose `icon` is the matching `IconItem` (with its `body`) from the supplied list, `borderRadius` equal to the file's `radius`, and the other values equal to the file's; the result has no `pngSize`, `preset` or `radius` key. Verified by a unit test.
5. **AC5, round trip.** `editorToSpec` → `serializeSettings` → `parseSettings` returns settings deeply equal to the starting state, and `parseSettings` → `editorToSpec` on a full spec returns that spec minus `pngSize`. Verified by unit tests.
6. **AC6, preset and defaults like the CLI.** A file with only `icon` and `preset: "Ocean Breeze"` imports with the preset's five values and the CLI defaults for the rest; a file with that preset and an explicit `strokeColor` keeps the explicit colour. The expected values are computed with `resolveSpec`. Verified by unit tests.
7. **AC7, refusals leave the design alone.** `parseSettings` returns `ok: false` and no settings for: text that is not JSON (`not a JSON file`), a JSON array, an unknown property, an out-of-range number, a bad icon format, an unknown preset, and a well-formed icon id that is not in the list (message names the id). Validator failures carry the exact messages `validateSpec` returns. Verified by unit tests; that the UI applies nothing on `ok: false` is verified by review of `settings-menu.tsx` and by running the editor.
8. **AC8, one validator.** `cli/spec.ts` contains no logic of its own: it only re-exports `src/lib/logo-spec.ts`, and `validateSpec` imported from either path is the same function. Verified by a unit test (`toBe`) and the unchanged CLI suite passing.
9. **AC9, nothing else breaks.** `pnpm build`, `tsc --noEmit`, `prettier --check` on the changed files and the full vitest suite (the CLI's 118 tests plus the new ones) pass. Verified by running them in the gate.
10. **AC10, seen working.** In the running editor (`pnpm dev`): export a design, render it with the CLI and see the same composition as the preview; import a CLI spec file and see the design change; import an invalid file and see a toast while the design stays; undo after an import restores the previous design; Randomize, Clear and autosave across a reload still work. Verified by driving the app in a browser and recording what was seen in the PR.
11. **AC11, documented.** README gains a short "Save and load designs" section covering both buttons and the CLI round trip. Verified by review.

## 5. Risks

- The editor's state can hold values the validator rejects (Randomize can produce a five-digit hex colour, which is still a non-empty string and passes; a hand-edited `localStorage` could hold anything). Export validates its own output, so the failure is a visible refusal rather than a file the CLI rejects.
- Moving `cli/spec.ts` changes the file the mutation gate (`hollow-test`) attributes the spec logic to; the spec tests stay in `cli/spec.test.ts` and keep covering it through the re-export.
- The editor has no component tests and vitest runs in a `node` environment; the UI file is kept thin (file picker, toasts, two provider calls) and is verified by running the app, with all logic in the pure module.
