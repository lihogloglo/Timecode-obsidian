import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	debounce,
} from "obsidian";
import type { Extension, Text } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

interface SpokenTimeRulerSettings {
	enabled: boolean;
	wordsPerMinute: number;
	minorTickSeconds: number;
	majorTickSeconds: number;
	showLabels: boolean;
	ignoreCodeBlocks: boolean;
}

const DEFAULT_SETTINGS: SpokenTimeRulerSettings = {
	enabled: true,
	wordsPerMinute: 150,
	minorTickSeconds: 30,
	majorTickSeconds: 300,
	showLabels: true,
	ignoreCodeBlocks: true,
};

type TickInfo = {
	seconds: number;
	label: string;
	major: boolean;
};

type MarkerCache = {
	settingsKey: string;
	markers: Map<number, TickInfo>;
};

const markerCache = new WeakMap<Text, MarkerCache>();

class SpokenTimeTickMarker extends GutterMarker {
	constructor(private readonly tick: TickInfo) {
		super();
	}

	eq(other: GutterMarker): boolean {
		if (!(other instanceof SpokenTimeTickMarker)) {
			return false;
		}

		return (
			other.tick.seconds === this.tick.seconds &&
			other.tick.label === this.tick.label &&
			other.tick.major === this.tick.major
		);
	}

	toDOM(): HTMLElement {
		const wrapper = document.createElement("div");
		wrapper.className = "spoken-time-ruler-tick";
		wrapper.title = `Estimated spoken time: ${this.tick.label}`;

		if (this.tick.major) {
			wrapper.classList.add("is-major");
		}

		const label = document.createElement("span");
		label.className = "spoken-time-ruler-label";
		label.textContent = this.tick.label;
		wrapper.appendChild(label);

		if (this.tick.label) {
			wrapper.classList.add("has-label");
		}

		return wrapper;
	}
}

export default class SpokenTimeRulerPlugin extends Plugin {
	options: SpokenTimeRulerSettings;
	private editorExtensions: Extension[] = [];
	private statusBarItem: HTMLElement;
	private readonly updateStatusBar = debounce(() => {
		this.refreshStatusBar();
	}, 100, true);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass("spoken-time-ruler-status");

		this.rebuildEditorExtensions();
		this.registerEditorExtension(this.editorExtensions);

		this.addCommand({
			id: "toggle-spoken-time-ruler",
			name: "Toggle spoken time ruler",
			callback: async () => {
				this.options.enabled = !this.options.enabled;
				await this.saveSettings();
				this.rebuildEditorExtensions();
				this.refreshStatusBar();
				new Notice(`Spoken Time Ruler ${this.options.enabled ? "enabled" : "disabled"}`);
			},
		});

		this.addCommand({
			id: "increase-spoken-time-wpm",
			name: "Increase spoken time WPM",
			callback: async () => {
				this.options.wordsPerMinute = Math.min(320, this.options.wordsPerMinute + 10);
				await this.saveSettings();
				this.rebuildEditorExtensions();
				this.refreshStatusBar();
				new Notice(`Spoken speed: ${this.options.wordsPerMinute} WPM`);
			},
		});

		this.addCommand({
			id: "decrease-spoken-time-wpm",
			name: "Decrease spoken time WPM",
			callback: async () => {
				this.options.wordsPerMinute = Math.max(60, this.options.wordsPerMinute - 10);
				await this.saveSettings();
				this.rebuildEditorExtensions();
				this.refreshStatusBar();
				new Notice(`Spoken speed: ${this.options.wordsPerMinute} WPM`);
			},
		});

		this.addSettingTab(new SpokenTimeRulerSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatusBar()));
		this.registerEvent(this.app.workspace.on("editor-change", () => this.updateStatusBar()));
		this.refreshStatusBar();
	}

	async loadSettings(): Promise<void> {
		this.options = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.options);
	}

	rebuildEditorExtensions(): void {
		this.editorExtensions.length = 0;

		if (this.options.enabled) {
			this.editorExtensions.push(createSpokenTimeRulerExtension(this));
		}

		this.app.workspace.updateOptions();
	}

	private refreshStatusBar(): void {
		if (!this.statusBarItem) {
			return;
		}

		if (!this.options.enabled) {
			this.statusBarItem.empty();
			this.statusBarItem.hide();
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			this.statusBarItem.empty();
			this.statusBarItem.hide();
			return;
		}

		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		const text = markdownView?.editor?.getValue();
		if (!text) {
			this.statusBarItem.empty();
			this.statusBarItem.hide();
			return;
		}

		const words = countWordsInText(text, this.options.ignoreCodeBlocks);
		const seconds = wordsToSeconds(words, this.options.wordsPerMinute);
		this.statusBarItem.setText(`${formatTime(seconds)} spoken`);
		this.statusBarItem.title = `${words} words at ${this.options.wordsPerMinute} WPM`;
		this.statusBarItem.show();
	}
}

function createSpokenTimeRulerExtension(plugin: SpokenTimeRulerPlugin): Extension {
	return [
		gutter({
			class: "spoken-time-ruler-gutter",
			lineMarker(view, line) {
				if (!plugin.options.enabled) {
					return null;
				}

				const lineNumber = view.state.doc.lineAt(line.from).number;
				const tick = getMarkerMap(view.state.doc, plugin.options).get(lineNumber);
				return tick ? new SpokenTimeTickMarker(tick) : null;
			},
			initialSpacer() {
				return new SpokenTimeTickMarker({
					seconds: plugin.options.majorTickSeconds,
					label: formatTime(plugin.options.majorTickSeconds),
					major: true,
				});
			},
		}),
		EditorView.baseTheme({
			".spoken-time-ruler-gutter": {
				boxSizing: "border-box",
			},
		}),
	];
}

function getMarkerMap(doc: Text, settings: SpokenTimeRulerSettings): Map<number, TickInfo> {
	const settingsKey = [
		settings.wordsPerMinute,
		settings.minorTickSeconds,
		settings.majorTickSeconds,
		settings.showLabels,
		settings.ignoreCodeBlocks,
	].join(":");

	const cached = markerCache.get(doc);
	if (cached?.settingsKey === settingsKey) {
		return cached.markers;
	}

	const markers = buildMarkerMap(doc, settings);
	markerCache.set(doc, { settingsKey, markers });
	return markers;
}

function buildMarkerMap(doc: Text, settings: SpokenTimeRulerSettings): Map<number, TickInfo> {
	const markers = new Map<number, TickInfo>();
	const wpm = clamp(settings.wordsPerMinute, 1, 1000);
	const minorTickSeconds = clamp(settings.minorTickSeconds, 5, 3600);
	const majorTickSeconds = clamp(settings.majorTickSeconds, minorTickSeconds, 7200);
	let wordCount = 0;
	let nextTickSeconds = minorTickSeconds;
	let inCodeBlock = false;
	let inFrontmatter = false;

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
		const line = doc.line(lineNumber);
		const text = line.text;
		const trimmed = text.trim();

		if (lineNumber === 1 && trimmed === "---") {
			inFrontmatter = true;
			continue;
		}

		if (inFrontmatter) {
			if (lineNumber > 1 && trimmed === "---") {
				inFrontmatter = false;
			}
			continue;
		}

		if (settings.ignoreCodeBlocks && isFenceLine(trimmed)) {
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (settings.ignoreCodeBlocks && inCodeBlock) {
			continue;
		}

		wordCount += countWords(text);
		const elapsedSeconds = wordsToSeconds(wordCount, wpm);

		while (elapsedSeconds >= nextTickSeconds) {
			const major = nextTickSeconds % majorTickSeconds === 0;
			if (!markers.has(lineNumber) || major) {
				markers.set(lineNumber, {
					seconds: nextTickSeconds,
					label: settings.showLabels || major ? formatTime(nextTickSeconds) : "",
					major,
				});
			}
			nextTickSeconds += minorTickSeconds;
		}
	}

	return markers;
}

function countWordsInText(text: string, ignoreCodeBlocks: boolean): number {
	let words = 0;
	let inCodeBlock = false;
	let inFrontmatter = false;
	const lines = text.split(/\r?\n/);

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();

		if (index === 0 && trimmed === "---") {
			inFrontmatter = true;
			continue;
		}

		if (inFrontmatter) {
			if (index > 0 && trimmed === "---") {
				inFrontmatter = false;
			}
			continue;
		}

		if (ignoreCodeBlocks && isFenceLine(trimmed)) {
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (ignoreCodeBlocks && inCodeBlock) {
			continue;
		}

		words += countWords(line);
	}

	return words;
}

function countWords(text: string): number {
	const cleaned = text
		.replace(/`[^`]*`/g, " ")
		.replace(/!\[[^\]]*]\([^)]+\)/g, " ")
		.replace(/\[([^\]]+)]\([^)]+\)/g, " $1 ")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[#>*_\-~=[\]()`{}|]/g, " ");

	return cleaned.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function wordsToSeconds(words: number, wordsPerMinute: number): number {
	return Math.round((words / wordsPerMinute) * 60);
}

function formatTime(totalSeconds: number): string {
	const roundedSeconds = Math.max(0, Math.round(totalSeconds));
	const hours = Math.floor(roundedSeconds / 3600);
	const minutes = Math.floor((roundedSeconds % 3600) / 60);
	const seconds = roundedSeconds % 60;

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}

	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isFenceLine(trimmedLine: string): boolean {
	return trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~");
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

class SpokenTimeRulerSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SpokenTimeRulerPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Show spoken time ruler")
			.setDesc("Adds estimated spoken-time ticks to the editor gutter.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.options.enabled).onChange(async (value) => {
					this.plugin.options.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.rebuildEditorExtensions();
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("Words per minute")
			.setDesc("Typical narration is often around 130-170 WPM; faster presentation can be 180+ WPM.")
			.addSlider((slider) =>
				slider
					.setLimits(60, 320, 5)
					.setValue(this.plugin.options.wordsPerMinute)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.options.wordsPerMinute = value;
						await this.plugin.saveSettings();
						this.plugin.rebuildEditorExtensions();
					})
			);

		new Setting(containerEl)
			.setName("Minor tick interval")
			.setDesc("Small tick spacing in seconds.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"15": "15 seconds",
						"30": "30 seconds",
						"60": "1 minute",
						"120": "2 minutes",
					})
					.setValue(String(this.plugin.options.minorTickSeconds))
					.onChange(async (value) => {
						this.plugin.options.minorTickSeconds = Number(value);
						if (this.plugin.options.majorTickSeconds < this.plugin.options.minorTickSeconds) {
							this.plugin.options.majorTickSeconds = this.plugin.options.minorTickSeconds;
						}
						await this.plugin.saveSettings();
						this.plugin.rebuildEditorExtensions();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Labeled tick interval")
			.setDesc("Large tick spacing in seconds.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"60": "1 minute",
						"120": "2 minutes",
						"300": "5 minutes",
						"600": "10 minutes",
					})
					.setValue(String(this.plugin.options.majorTickSeconds))
					.onChange(async (value) => {
						this.plugin.options.majorTickSeconds = Math.max(
							Number(value),
							this.plugin.options.minorTickSeconds
						);
						await this.plugin.saveSettings();
						this.plugin.rebuildEditorExtensions();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Show labels")
			.setDesc("Labels are always shown for large ticks.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.options.showLabels).onChange(async (value) => {
					this.plugin.options.showLabels = value;
					await this.plugin.saveSettings();
					this.plugin.rebuildEditorExtensions();
				})
			);

		new Setting(containerEl)
			.setName("Ignore fenced code blocks")
			.setDesc("Exclude triple-backtick and triple-tilde code blocks from spoken-time estimates.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.options.ignoreCodeBlocks).onChange(async (value) => {
					this.plugin.options.ignoreCodeBlocks = value;
					await this.plugin.saveSettings();
					this.plugin.rebuildEditorExtensions();
				})
			);
	}
}
