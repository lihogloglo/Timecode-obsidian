# Spoken Time Ruler

Spoken Time Ruler is an Obsidian plugin that adds estimated spoken-time ticks to the editor gutter, plus a status bar estimate for the current note.

## Features

- Spoken-time ruler ticks in Markdown editor gutters.
- Configurable words per minute, minor ticks, and labeled major ticks.
- Optional exclusion of fenced code blocks and frontmatter.

## Development

```bash
cd plugin-work/spoken-time-ruler
npm install
npm run build
```

To install manually, copy `manifest.json`, `styles.css`, and the generated `main.js` into:

```text
<your-vault>/.obsidian/plugins/spoken-time-ruler/
```

Released under the MIT license.
