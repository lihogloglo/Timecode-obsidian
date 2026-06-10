# Spoken Time Ruler

Development workspace for the local Obsidian plugin.

The actual plugin installed in the vault is:

```text
../../.obsidian/plugins/spoken-time-ruler/
  manifest.json
  main.js
  styles.css
```

Build after editing `main.ts`:

```bash
npm run build
```

That writes the compiled plugin to `../../.obsidian/plugins/spoken-time-ruler/main.js`.

The first version attaches ticks to Markdown source lines. If a paragraph is one very long wrapped line, the tick is attached to that source line rather than the exact visual wrap row.
