import { App, Platform, TFile, setIcon, setTooltip } from "obsidian";
import type { Canvas, CanvasNode, CanvasView } from "./canvas";
import { t } from "./i18n";

/** Apple keyboards (Mac, and iPad / iPhone with a hardware keyboard) use Cmd where others use Ctrl. */
export function usesCmd(): boolean {
	return Platform.isMacOS || Platform.isIosApp;
}

export function isShiftTab(evt: KeyboardEvent): boolean {
	return evt.key === "Tab" && evt.shiftKey && !evt.ctrlKey && !evt.metaKey && !evt.altKey;
}

export function isFindKey(evt: KeyboardEvent): boolean {
	const mod = usesCmd() ? evt.metaKey && !evt.ctrlKey : evt.ctrlKey && !evt.metaKey;
	return mod && !evt.shiftKey && !evt.altKey && evt.key.toLowerCase() === "f";
}

/**
 * Find bar for one canvas view, built from Obsidian's own find-bar classes so it looks native.
 * Matching nodes are highlighted, the rest dimmed; Enter / Shift+Enter walk through them.
 */
export class CanvasSearch {
	private containerEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private countEl: HTMLElement | null = null;
	private hits: CanvasNode[] = [];
	private index = -1;
	private noteText = new Map<string, string>();
	private timer = 0;

	private pending = false;

	/** `beforeReveal` runs before a result is shown, so a node inside a collapsed branch can be brought back. */
	constructor(private app: App, private view: CanvasView, private onClosed: () => void, private beforeReveal: (node: CanvasNode) => void) {}

	private get canvas(): Canvas {
		return this.view.canvas;
	}

	open() {
		if (!this.containerEl) this.build();
		void this.loadNotes();
		this.inputEl?.focus();
		this.inputEl?.select();
		if (this.inputEl?.value) this.run();
	}

	private build() {
		const s = t();
		const container = (this.containerEl = this.view.contentEl.createDiv({ cls: "document-search-container arbor-search", prepend: true }));
		const bar = container.createDiv({ cls: "document-search" });
		const inputWrap = bar.createDiv({ cls: "search-input-container document-search-input" });
		const input = (this.inputEl = inputWrap.createEl("input", { type: "text", placeholder: s.searchPlaceholder }));
		this.countEl = inputWrap.createDiv({ cls: "document-search-count" });
		const buttons = bar.createDiv({ cls: "document-search-buttons" });
		const button = (icon: string, tip: string, run: () => void, cls = "clickable-icon document-search-button") => {
			const el = buttons.createEl("button", { cls });
			setIcon(el, icon);
			setTooltip(el, tip, { placement: "top" });
			el.addEventListener("mousedown", (evt) => evt.preventDefault()); // keep focus in the input
			el.addEventListener("click", (evt) => {
				evt.preventDefault();
				run();
			});
		};
		button("arrow-up", `${s.searchPrev} (Shift+Enter)`, () => this.step(-1));
		button("arrow-down", `${s.searchNext} (Enter)`, () => this.step(1));
		button("x", `${s.searchClose} (Esc)`, () => this.close(true), "clickable-icon document-search-close-button");

		input.addEventListener("input", () => {
			window.clearTimeout(this.timer);
			this.pending = true;
			this.timer = window.setTimeout(() => {
				this.pending = false;
				this.run();
			}, 120);
		});
		input.addEventListener("keydown", (evt) => {
			if (evt.isComposing || evt.key === "Process") return; // an input method is still choosing characters
			if (evt.key === "Enter") {
				evt.preventDefault();
				evt.stopPropagation();
				if (this.pending) {
					// Typed and hit Enter before the debounce: search now, so Enter walks the new results.
					window.clearTimeout(this.timer);
					this.pending = false;
					this.run(false);
				}
				this.step(evt.shiftKey ? -1 : 1);
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				evt.stopPropagation();
				this.close(true);
			}
		});
	}

	/** Contents of Markdown notes shown in file nodes, so their text is searchable too. */
	private async loadNotes() {
		const files = new Set<TFile>();
		for (const n of this.canvas.nodes.values()) if (n.file && n.file.extension === "md") files.add(n.file);
		await Promise.all(
			[...files].map(async (f) => {
				try {
					this.noteText.set(f.path, await this.app.vault.cachedRead(f));
				} catch {
					/* unreadable: search its name only */
				}
			}),
		);
		if (this.inputEl?.value) this.run(false);
	}

	private textOf(n: CanvasNode): string {
		const d = n.getData();
		const parts = [d.text, d.label, d.url];
		if (n.file) parts.push(n.file.basename, this.noteText.get(n.file.path));
		else if (d.file) parts.push(d.file);
		return parts.filter((p): p is string => typeof p === "string").join("\n").toLowerCase();
	}

	private run(jump = true) {
		const query = (this.inputEl?.value ?? "").trim().toLowerCase();
		this.clearMarks();
		this.hits = [];
		this.index = -1;
		if (!query) {
			this.setCount("");
			return;
		}
		const words = query.split(/\s+/);
		this.hits = [...this.canvas.nodes.values()]
			.filter((n) => {
				const text = this.textOf(n);
				return words.every((w) => text.includes(w));
			})
			.sort((a, b) => a.y - b.y || a.x - b.x);
		this.canvas.wrapperEl.addClass("arbor-searching");
		this.hits.forEach((n) => n.nodeEl.addClass("arbor-search-hit"));
		if (!this.hits.length) {
			this.setCount(t().searchNone);
			return;
		}
		if (jump) this.step(1);
		else this.setCount(`0 / ${this.hits.length}`);
	}

	private step(delta: number) {
		if (!this.hits.length) return;
		this.hits[this.index]?.nodeEl.removeClass("arbor-search-current");
		this.index = (this.index + delta + this.hits.length) % this.hits.length;
		const node = this.hits[this.index];
		node.nodeEl.addClass("arbor-search-current");
		this.setCount(`${this.index + 1} / ${this.hits.length}`);
		this.reveal(node);
	}

	/** Centre the node; zoom in first if the canvas is too far out to read it. */
	private reveal(node: CanvasNode) {
		const c = this.canvas;
		this.beforeReveal(node);
		const box = node.getBBox();
		if (c.zoom < c.zoomBreakpoint + 0.5) {
			const pad = 300;
			c.zoomToBbox({ minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad });
		} else {
			c.panTo((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
		}
	}

	private setCount(text: string) {
		this.countEl?.setText(text);
	}

	private clearMarks() {
		this.canvas.wrapperEl.removeClass("arbor-searching");
		this.canvas.wrapperEl.querySelectorAll(".arbor-search-hit, .arbor-search-current").forEach((el) => el.removeClass("arbor-search-hit", "arbor-search-current"));
	}

	/** `keepCurrent`: leave the result you were on selected, so Shift+Enter edits it straight away. */
	close(keepCurrent: boolean) {
		window.clearTimeout(this.timer);
		this.pending = false;
		const current = this.hits[this.index];
		this.clearMarks();
		this.containerEl?.remove();
		this.containerEl = this.inputEl = this.countEl = null;
		this.onClosed();
		if (keepCurrent && current && this.canvas.nodes.has(current.id)) {
			this.canvas.selectOnly(current);
			this.canvas.wrapperEl.focus();
		}
	}
}
