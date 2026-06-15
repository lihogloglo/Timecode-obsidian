# Spoken Time Ruler

Obsidian plugin that adds estimated spoken-time ticks to the editor gutter and shows the current note's spoken duration in the status bar.

## Development

```bash
npm install
npm run build
```

The build creates `main.js` next to `manifest.json` and `styles.css`. To install manually, copy those three files into:

```text
<your-vault>/.obsidian/plugins/spoken-time-ruler/
```

Ticks attach to Markdown source lines, so one very long wrapped paragraph gets a tick on its source line rather than an exact visual wrap row.
