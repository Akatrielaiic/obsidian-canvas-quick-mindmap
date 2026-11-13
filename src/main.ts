import { ItemView, KeymapContext, KeymapEventHandler, Notice, Platform, Plugin, TAbstractFile, TFile, debounce, normalizePath, setIcon, setTooltip } from "obsidian";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { around } from "monkey-around";
import type { BBox, Canvas, CanvasMenu, CanvasNode, CanvasView } from "./canvas";
import { Side, SIDES, bboxOf, center, edgeCurve, inBox, labelSpace, linkReach, moveBy, overlaps, unionBox } from "./geometry";
import { t } from "./i18n";
import { NodeSize, Offset, positions, shapeOf, span } from "./layout";
import { OutlineItem, formatOutline, parseOutline } from "./outline";
import { CanvasSearch, isFindKey, isShiftTab, usesCmd } from "./search";
import { DEFAULT_SETTINGS, Fold, SettingTab, Settings } from "./settings";
import { IMAGE_EXTENSIONS, applyReplacements, mentions, plainText, randomId, replacements } from "./text";
import {
	ArrowKey,
	Dir,
	SIDE_PAIR,
	Tree,
	branchEdgeBetween,
	branchEdges,
	buildTree,
	clockwise,
	dirFrom,
	forgetBranches,
	hooks,
	isBranchLook,
	isGroup,
	neighbour,
	outgoing,
	parentOf,
	readingOrder,
	rootOf,
	sideOf,
	structureOf,
	subtreeBottom,
} from "./tree";

type Action = "child" | "sibling";
interface Size { width: number; height: number }

const ARROWS = new Set<string>(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** A key registered in a Scope, as Obsidian keeps it (internal). */
interface ScopeKey { key: string | null; modifiers: string | null; func(evt: KeyboardEvent, ctx: KeymapContext): unknown }

export default class CanvasArbor extends Plugin {
	settings: Settings = { ...DEFAULT_SETTINGS, folds: {} };
	private restoreMenu: (() => void) | null = null;

	async onload() {
		await this.loadSettings();
		hooks.linkArrows = () => this.settings.linkArrows;
		hooks.hidden = (n) => this.hiddenIds.get(n.canvas)?.has(n.id) ?? false;
		hooks.collapsed = (n) => !!this.foldsFor(n.canvas)?.[n.id];
		const s = t();

		this.addCommand({ id: "add-child", name: s.addChild, icon: "arrow-right-from-line", checkCallback: (checking) => this.commandFor("child", checking) });
		this.addCommand({ id: "add-sibling", name: s.addSibling, icon: "arrow-down-from-line", checkCallback: (checking) => this.commandFor("sibling", checking) });
		/** Commands on the one selected node of an editable canvas. */
		const onNode = (able: (node: CanvasNode) => boolean, run: (node: CanvasNode) => void) => (checking: boolean) => {
			const canvas = this.activeCanvas();
			const node = canvas && this.singleSelected(canvas);
			if (!node || !able(node)) return false;
			if (!checking) run(node);
			return true;
		};
		this.addCommand({ id: "select-parent", name: s.selectParent, icon: "arrow-left-from-line", checkCallback: onNode((n) => !!parentOf(n), (n) => this.selectParent(n)) });
		this.addCommand({
			id: "toggle-fold",
			name: s.toggleFold,
			icon: "chevrons-down-up",
			checkCallback: onNode((n) => hooks.collapsed(n) || outgoing(n).length > 0, (n) => this.toggleFold(n)),
		});
		this.addCommand({ id: "move-before", name: s.moveBefore, icon: "arrow-up", checkCallback: onNode((n) => !!this.siblingAt(n, -1), (n) => this.reorder(n, -1)) });
		this.addCommand({ id: "move-after", name: s.moveAfter, icon: "arrow-down", checkCallback: onNode((n) => !!this.siblingAt(n, 1), (n) => this.reorder(n, 1)) });
		this.addCommand({
			id: "expand-all",
			name: s.expandAll,
			icon: "chevrons-up-down",
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				if (!canvas || canvas.readonly || !Object.keys(this.foldsFor(canvas) ?? {}).length) return false;
				if (!checking) this.expandAll(canvas);
				return true;
			},
		});
		this.addCommand({
			id: "search-canvas",
			name: s.search,
			icon: "search",
			checkCallback: (checking) => {
				const view = this.activeCanvasView();
				if (!view) return false;
				if (!checking) this.openSearch(view);
				return true;
			},
		});
		const onMaps = (fn: (root: CanvasNode) => void) => (checking: boolean) => {
			const canvas = this.activeCanvas();
			if (!canvas || canvas.readonly) return false;
			const node = this.singleSelected(canvas);
			const roots = (node ? [rootOf(node)] : this.roots(canvas)).filter((r) => outgoing(r).length);
			if (!roots.length) return false;
			if (!checking) {
				for (const r of roots) fn(r);
				canvas.requestSave();
			}
			return true;
		};
		this.addCommand({ id: "balance-map", name: s.balance, icon: "git-fork", checkCallback: onMaps((r) => this.balance(r)) });
		this.addCommand({ id: "grow-right", name: s.growRight, icon: "arrow-right-to-line", checkCallback: onMaps((r) => this.restructure(r, "right")) });
		this.addCommand({ id: "grow-down", name: s.growDown, icon: "arrow-down-to-line", checkCallback: onMaps((r) => this.restructure(r, "down")) });
		this.addCommand({
			id: "tidy-layout",
			name: s.relayout,
			icon: "list-tree",
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) this.tidy(canvas);
				return true;
			},
		});
		this.addCommand({
			id: "copy-outline",
			name: s.copyOutline,
			icon: "list",
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				if (!canvas || !this.outlineTops(canvas).length) return false;
				if (!checking) void this.copyOutline(canvas);
				return true;
			},
		});
		this.addCommand({
			id: "paste-outline",
			name: s.pasteOutline,
			icon: "list-plus",
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) void this.pasteOutline(canvas);
				return true;
			},
		});

		// Typing inside a node: the editor lives in an iframe, so its keys never reach window listeners.
		this.registerEditorExtension([
			Prec.highest(EditorView.domEventHandlers({ keydown: (evt, view) => this.onEditorKeydown(evt, view) })),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) this.onEditorChanged(update.view);
			}),
		]);

		// A node selected but not being edited.
		this.registerDomEvent(window, "keydown", (evt) => this.onWindowKeydown(evt), { capture: true });
		this.registerEvent(
			this.app.workspace.on("window-open", (_w, win) => {
				this.registerDomEvent(win, "keydown", (evt) => this.onWindowKeydown(evt), { capture: true });
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			this.onLayoutChanged();
			// Registered after load: the vault fires "create" for every existing file while it starts up.
			this.registerEvent(this.app.vault.on("create", (file) => this.onFileCreated(file)));
		});
		this.registerEvent(this.app.workspace.on("layout-change", () => this.onLayoutChanged()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.refreshAllFolds(true)));
		// A saved canvas: nodes may have been deleted, restored by undo or moved by hand.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile) || file.extension !== "canvas") return;
				for (const view of this.canvasViews()) if (view.file === file && view.canvas) this.refreshFolds(view.canvas);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const folds = this.settings.folds[oldPath];
				if (!folds) return;
				delete this.settings.folds[oldPath];
				this.settings.folds[file.path] = folds;
				this.saveFolds();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!this.settings.folds[file.path]) return;
				delete this.settings.folds[file.path];
				this.saveFolds();
			}),
		);

		// Measured sizes depend on the theme and on fonts that may still be loading.
		this.registerEvent(this.app.workspace.on("css-change", () => this.sizeCache.clear()));
		const fonts = activeDocument.fonts;
		const onFonts = () => this.sizeCache.clear();
		fonts?.addEventListener?.("loadingdone", onFonts);
		this.register(() => fonts?.removeEventListener?.("loadingdone", onFonts));

		// Every canvas, including those in popout windows, not just the active document.
		this.register(() => {
			for (const view of this.canvasViews()) {
				view.containerEl.querySelectorAll(".arbor-tidy, .arbor-fold-badge").forEach((el) => el.remove());
				view.containerEl.querySelectorAll(".arbor-hidden, .arbor-collapsed").forEach((el) => el.classList.remove("arbor-hidden", "arbor-collapsed"));
			}
		});

		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {
		this.restoreMenu?.();
		for (const [view, handlers] of this.findKeys) for (const handler of handlers) view.scope?.unregister(handler);
		for (const search of this.searches.values()) search.close(false);
		for (const timer of this.fitTimers.values()) window.clearTimeout(timer);
		this.fitTimers.clear();
		hooks.linkArrows = () => true;
		hooks.hidden = () => false;
		hooks.collapsed = () => false;
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<Settings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data, { folds: { ...data?.folds } });
	}

	async saveSettings() {
		this.sizeCache.clear(); // the maximum width may have changed
		await this.saveData(this.settings);
	}

	// ---------- Entry points ----------

	private canvasViews(): CanvasView[] {
		return this.app.workspace.getLeavesOfType("canvas").map((l) => l.view as CanvasView);
	}

	private viewOf(canvas: Canvas): CanvasView | null {
		return canvas.view ?? this.canvasViews().find((v) => v.canvas === canvas) ?? null;
	}

	private activeCanvasView(): CanvasView | null {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		return view && view.getViewType() === "canvas" && (view as CanvasView).canvas ? (view as CanvasView) : null;
	}

	private activeCanvas(): Canvas | null {
		return this.activeCanvasView()?.canvas ?? null;
	}

	/** The one selected node, whether or not the canvas can be edited. */
	private selectedNode(canvas: Canvas): CanvasNode | null {
		if (canvas.selection.size !== 1) return null;
		const [node] = canvas.selection;
		if (!node || !("getData" in node) || isGroup(node)) return null; // edges can be selected too
		return node;
	}

	private singleSelected(canvas: Canvas): CanvasNode | null {
		return canvas.readonly ? null : this.selectedNode(canvas);
	}

	/** Central nodes of the maps on a canvas, top to bottom. */
	private roots(canvas: Canvas): CanvasNode[] {
		const roots = [...canvas.nodes.values()].filter((n) => !isGroup(n) && !hooks.hidden(n) && !parentOf(n) && (outgoing(n).length || hooks.collapsed(n)));
		return roots.sort((a, b) => a.y - b.y || a.x - b.x);
	}

	private commandFor(action: Action, checking: boolean): boolean {
		const canvas = this.activeCanvas();
		const node = canvas && this.singleSelected(canvas);
		if (!node) return false;
		if (!checking) this.add(node, action);
		return true;
	}

	private onLayoutChanged() {
		this.patchMenuFromOpenCanvas();
		this.addTidyButtons();
		this.refreshAllFolds(true);
	}

	private onWindowKeydown(evt: KeyboardEvent) {
		if (evt.defaultPrevented || evt.isComposing || evt.key === "Process") return;
		if (isFindKey(evt)) {
			const view = this.activeCanvasView();
			if (!view) return;
			evt.preventDefault();
			evt.stopPropagation();
			this.openSearch(view);
			return;
		}
		const canvas = this.activeCanvas();
		if (!canvas) return;
		// Shift+arrow normally arrives through the canvas view's own keys (see claimKeys); Alt+arrow comes here.
		if (ARROWS.has(evt.key)) {
			if (this.onArrow(evt, canvas)) {
				evt.preventDefault();
				evt.stopPropagation();
			}
			return;
		}
		const back = isShiftTab(evt);
		if (!back && (evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey)) return;
		// Tab adds a child; Shift+Tab goes back to the parent; Enter opens the selected node for editing (siblings: Enter while typing, or the + below).
		const action: Action | "edit" | "parent" | null = back ? "parent" : evt.key === "Tab" ? "child" : evt.key === "Enter" ? "edit" : null;
		if (!action || !this.keyIsForCanvas(evt, canvas)) return;

		const node = this.singleSelected(canvas);
		if (!node || node.isEditing) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (action === "edit") this.edit(node);
		else if (action === "parent") this.selectParent(node);
		else this.add(node, action);
	}

	/** A key pressed on the canvas itself: not in a text field, a menu or a dialog. */
	private keyIsForCanvas(evt: KeyboardEvent, canvas: Canvas): boolean {
		const target = evt.target as HTMLElement | null;
		const doc = canvas.wrapperEl.ownerDocument;
		const onCanvas = !target || target === doc.body || canvas.wrapperEl.contains(target);
		if (!onCanvas || target?.closest("input, textarea, [contenteditable='true']")) return false;
		return !doc.querySelector(".modal-container, .suggestion-container, .menu");
	}

	/**
	 * Shift+arrow on the selected node of a map moves to a neighbour, Alt+arrow trades places with a
	 * sibling. False when the key is not ours (a card outside any map, a text field…), so Canvas keeps it.
	 */
	private onArrow(evt: KeyboardEvent, canvas: Canvas): boolean {
		// Shift moves between nodes, Alt reorders; plain arrows stay with Canvas, which nudges the card.
		if (!this.settings.arrowKeys || !ARROWS.has(evt.key) || evt.ctrlKey || evt.metaKey || evt.shiftKey === evt.altKey) return false;
		if (evt.isComposing || !this.keyIsForCanvas(evt, canvas)) return false;
		const node = this.singleSelected(canvas);
		if (!node || node.isEditing) return false;
		if (!parentOf(node) && !outgoing(node).length) return false;
		if (evt.altKey) this.reorderByKey(node, evt.key as ArrowKey);
		else this.go(node, evt.key as ArrowKey);
		return true;
	}

	/**
	 * Start editing a node with the cursor at the end of its text. The canvas only focuses an editor
	 * once it is on screen, so bring the node into view first, then wait for the editor to take focus.
	 */
	private edit(node: CanvasNode) {
		node.canvas.panIntoView(node.getBBox());
		window.setTimeout(() => {
			node.startEditing();
			const deadline = Date.now() + 1000;
			const settle = () => {
				const cm = node.child?.editor?.cm;
				if (cm?.hasFocus) {
					cm.dispatch({ selection: { anchor: cm.state.doc.length } });
					return;
				}
				if (!node.isEditing || Date.now() >= deadline) return;
				node.child?.editMode?.focus();
				window.setTimeout(settle, 50);
			};
			window.setTimeout(settle, 50);
		}, 0);
	}

	private onEditorKeydown(evt: KeyboardEvent, view: EditorView): boolean {
		if (evt.isComposing || evt.key === "Process" || view.composing) return false;
		if (isFindKey(evt)) {
			const node = this.nodeForEditor(view);
			const canvasView = node && this.viewOf(node.canvas);
			if (!node || !canvasView) return false;
			evt.preventDefault();
			node.blur();
			this.openSearch(canvasView);
			return true;
		}
		if (isShiftTab(evt)) {
			const node = this.nodeForEditor(view);
			if (!node || !parentOf(node)) return false;
			if (activeDocument.querySelector(".suggestion-container") || view.dom.ownerDocument.querySelector(".suggestion-container")) return false;
			evt.preventDefault();
			this.selectParent(node);
			return true;
		}
		if (evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey) return false;
		let action: Action | null = null;
		// While typing, by default: Enter goes one level deeper, Tab adds the next node on the same level.
		// "Tab adds a child" swaps the two, as in most mind map apps.
		const swap = this.settings.tabAddsChild;
		if (evt.key === "Tab") action = swap ? "child" : "sibling";
		else if (evt.key === "Enter" && this.settings.enterInEdit && (!Platform.isMobile || this.settings.mobileKeys)) action = swap ? "sibling" : "child";
		if (!action) return false;

		const node = this.nodeForEditor(view);
		if (!node || node.canvas.readonly) return false;
		// Let an open autocomplete (links, tags…) take the key.
		if (activeDocument.querySelector(".suggestion-container") || view.dom.ownerDocument.querySelector(".suggestion-container")) return false;

		evt.preventDefault();
		this.add(node, action);
		return true;
	}

	private editorNodes = new WeakMap<EditorView, CanvasNode>();

	/** The canvas node an editor belongs to. Runs on every keystroke in every editor, so it must be cheap for ordinary notes. */
	private nodeForEditor(view: EditorView): CanvasNode | null {
		const known = this.editorNodes.get(view);
		if (known && known.isEditing && known.child?.editor?.cm === view && known.canvas.nodes.get(known.id) === known) return known;
		// A note's editor sits in a workspace document, outside any canvas: nothing to scan.
		// A node's editor is inside the canvas, or in an iframe of its own.
		const framed = !!view.dom.ownerDocument.defaultView?.frameElement;
		if (!framed && !view.dom.closest(".canvas-wrapper, .canvas-node")) return null;
		for (const { canvas } of this.canvasViews()) {
			if (!canvas) continue;
			for (const node of canvas.nodes.values()) {
				if (node.isEditing && node.child?.editor?.cm === view) {
					this.editorNodes.set(view, node);
					return node;
				}
			}
		}
		return null;
	}

	private select(node: CanvasNode) {
		const canvas = node.canvas;
		canvas.selectOnly(node);
		canvas.panIntoView(node.getBBox());
		canvas.wrapperEl.focus();
	}

	/** Leave the node (stop editing if needed) and select its parent, ready for Tab / Enter. */
	selectParent(node: CanvasNode) {
		const parent = parentOf(node);
		if (!parent) return;
		const canvas = node.canvas;
		if (node.isEditing) node.blur();
		if (this.settings.autoSize && this.fit(node)) {
			if (this.settings.autoLayout) this.layout(rootOf(parent));
			canvas.requestSave();
		}
		// After the current key event, or the closing editor takes the selection back.
		window.setTimeout(() => this.select(parent), 0);
	}

	// ---------- Moving around and reordering ----------

	private go(node: CanvasNode, key: ArrowKey) {
		const target = neighbour(node, key);
		if (target) this.select(target);
	}

	/** The siblings a node can trade places with: on its side of the map, in reading order. */
	private siblings(node: CanvasNode): { root: CanvasNode; kids: CanvasNode[]; down: boolean } | null {
		const parent = parentOf(node);
		if (!parent) return null;
		const root = rootOf(node);
		const tree = buildTree(root);
		const structure = readingOrder(root, tree);
		let kids = tree.get(parent) ?? [];
		if (parent === root && structure === "both") {
			const left = center(node) < center(root);
			kids = kids.filter((k) => center(k) < center(root) === left);
		}
		return { root, kids, down: structure === "down" };
	}

	private siblingAt(node: CanvasNode, delta: -1 | 1): CanvasNode | null {
		const sibs = this.siblings(node);
		return (sibs && sibs.kids[sibs.kids.indexOf(node) + delta]) ?? null;
	}

	/** Alt+arrow across the siblings' axis: up / down, or left / right in a downward map. */
	private reorderByKey(node: CanvasNode, key: ArrowKey) {
		const sibs = this.siblings(node);
		if (!sibs) return;
		if (key === (sibs.down ? "ArrowLeft" : "ArrowUp")) this.reorder(node, -1);
		else if (key === (sibs.down ? "ArrowRight" : "ArrowDown")) this.reorder(node, 1);
	}

	/**
	 * Trade places with the previous or next sibling. The order of siblings is read from where they
	 * sit, so the two swap positions and the map is laid out again (whatever "Auto layout" says).
	 */
	reorder(node: CanvasNode, delta: -1 | 1) {
		const sibs = this.siblings(node);
		const other = sibs?.kids[sibs.kids.indexOf(node) + delta];
		if (!sibs || !other) return;
		const a = { x: node.x, y: node.y };
		const b = { x: other.x, y: other.y };
		if (sibs.down) {
			node.moveAndResize({ x: b.x === a.x ? b.x + delta : b.x, y: a.y, width: node.width, height: node.height });
			other.moveAndResize({ x: a.x, y: b.y, width: other.width, height: other.height });
		} else {
			node.moveAndResize({ x: a.x, y: b.y === a.y ? b.y + delta : b.y, width: node.width, height: node.height });
			other.moveAndResize({ x: b.x, y: a.y, width: other.width, height: other.height });
		}
		this.layout(sibs.root);
		node.canvas.requestSave();
		node.canvas.panIntoView(node.getBBox());
	}

	// ---------- Collapsing branches ----------
	// A collapsed branch stays in the canvas file, so nothing is lost if the plugin is turned off:
	// its nodes and arrows are only hidden, and layout leaves them out. Which branches are collapsed
	// is kept in the plugin's data.

	private hiddenIds = new WeakMap<Canvas, Set<string>>();
	private saveFolds = debounce(() => void this.saveData(this.settings), 500, true);

	private foldsFor(canvas: Canvas, create = false): Record<string, Fold> | null {
		const path = this.viewOf(canvas)?.file?.path;
		if (!path) return null;
		if (!this.settings.folds[path] && create) this.settings.folds[path] = {};
		return this.settings.folds[path] ?? null;
	}

	toggleFold(node: CanvasNode) {
		if (hooks.collapsed(node)) this.expand(node);
		else this.collapse(node);
	}

	collapse(node: CanvasNode) {
		const canvas = node.canvas;
		const folds = this.foldsFor(canvas, true);
		const tree = buildTree(node);
		const anchor = tree.get(node)?.[0];
		if (!folds || !anchor) return;
		// Everything below the node, with what the branches collapsed inside it already hide.
		const ids = new Set<string>();
		for (const n of tree.keys()) {
			if (n === node) continue;
			ids.add(n.id);
			for (const id of folds[n.id]?.ids ?? []) ids.add(id);
		}
		folds[node.id] = { ids: [...ids], anchor: anchor.id, dx: anchor.x - node.x, dy: anchor.y - node.y };
		this.afterFold(node);
	}

	expand(node: CanvasNode) {
		const folds = this.foldsFor(node.canvas);
		if (!folds?.[node.id]) return;
		this.syncFolds(node.canvas); // bring the hidden nodes next to the node before they show again
		delete folds[node.id];
		this.afterFold(node);
	}

	private expandAll(canvas: Canvas) {
		const folds = this.foldsFor(canvas);
		if (!folds) return;
		this.syncFolds(canvas);
		for (const id of Object.keys(folds)) delete folds[id];
		this.refreshFolds(canvas);
		forgetBranches(canvas);
		if (this.settings.autoLayout) for (const root of this.roots(canvas)) this.layout(root);
		canvas.requestSave();
		this.saveFolds();
	}

	/** Show the node if a collapsed branch hides it (a search result, for instance). */
	reveal(node: CanvasNode) {
		const canvas = node.canvas;
		for (let i = 0; i < 100 && hooks.hidden(node); i++) {
			const folds = this.foldsFor(canvas) ?? {};
			const id = Object.keys(folds).find((k) => folds[k].ids.includes(node.id));
			const holder = id ? canvas.nodes.get(id) : undefined;
			if (!holder) break;
			this.expand(holder);
		}
	}

	private afterFold(node: CanvasNode) {
		const canvas = node.canvas;
		this.refreshFolds(canvas);
		forgetBranches(canvas);
		if (this.settings.autoLayout) this.layout(rootOf(node));
		canvas.requestSave();
		this.saveFolds();
		canvas.menu.render(true); // the collapse button changes
	}

	private refreshAllFolds(again = false) {
		for (const view of this.canvasViews()) if (view.canvas) this.refreshFolds(view.canvas);
		// A canvas that is still loading has no nodes yet.
		if (again) window.setTimeout(() => this.refreshAllFolds(), 400);
	}

	/**
	 * Bring the canvas in line with its collapsed branches: forget those whose node is gone, move
	 * hidden nodes along with their branch, and hide or show nodes, arrows and the count badges.
	 */
	refreshFolds(canvas: Canvas) {
		if (!canvas.nodes?.size) return;
		const folds = this.foldsFor(canvas);
		if (!folds && !this.hiddenIds.get(canvas)?.size) return;
		const hidden = new Set<string>();
		let changed = false;
		for (const [id, fold] of Object.entries(folds ?? {})) {
			const node = canvas.nodes.get(id);
			const ids = fold.ids.filter((i) => canvas.nodes.has(i));
			if (!node || !ids.length) {
				delete (folds as Record<string, Fold>)[id];
				changed = true;
				continue;
			}
			if (ids.length !== fold.ids.length) {
				fold.ids = ids;
				changed = true;
			}
			if (!canvas.nodes.has(fold.anchor)) {
				const anchor = canvas.nodes.get(ids[0]) as CanvasNode;
				Object.assign(fold, { anchor: anchor.id, dx: anchor.x - node.x, dy: anchor.y - node.y });
				changed = true;
			}
			for (const i of ids) hidden.add(i);
		}
		if (folds && !Object.keys(folds).length) {
			const path = this.viewOf(canvas)?.file?.path;
			if (path) delete this.settings.folds[path];
		}
		this.hiddenIds.set(canvas, hidden);
		if (changed) {
			this.saveFolds();
			forgetBranches(canvas);
		}
		if (this.syncFolds(canvas) && !canvas.readonly) canvas.requestSave();

		for (const n of canvas.nodes.values()) {
			const fold = folds?.[n.id];
			n.nodeEl.toggleClass("arbor-hidden", hidden.has(n.id));
			n.nodeEl.toggleClass("arbor-collapsed", !!fold);
			let badge = n.nodeEl.querySelector<HTMLElement>(":scope > .arbor-fold-badge");
			if (!fold) {
				badge?.remove();
				continue;
			}
			if (!badge) {
				badge = n.nodeEl.createDiv({ cls: "arbor-fold-badge", attr: { role: "button" } });
				setTooltip(badge, t().expandTip, { placement: "top" });
				for (const type of ["pointerdown", "mousedown", "dblclick"]) badge.addEventListener(type, (evt) => evt.stopPropagation());
				badge.addEventListener("click", (evt) => {
					evt.stopPropagation();
					if (!canvas.readonly) this.expand(n);
				});
			}
			badge.setText(String(fold.ids.length));
		}
		for (const e of canvas.edges.values()) {
			const hide = hidden.has(e.from.node?.id) || hidden.has(e.to.node?.id);
			for (const el of [e.lineGroupEl, e.lineEndGroupEl, e.labelElement?.wrapperEl]) el?.classList.toggle("arbor-hidden", hide);
		}
		// Nothing hidden stays selected, or the next key would act on something you can't see.
		if ([...canvas.selection].some((n) => hidden.has(n.id))) canvas.deselectAll?.();
	}

	/** Hidden nodes follow their collapsed node, wherever layout or a drag took it. Returns true if any moved. */
	private syncFolds(canvas: Canvas): boolean {
		const folds = this.foldsFor(canvas);
		if (!folds) return false;
		let moved = false;
		for (const [id, fold] of Object.entries(folds)) {
			const node = canvas.nodes.get(id);
			const anchor = canvas.nodes.get(fold.anchor);
			if (!node || !anchor) continue;
			const dx = node.x + fold.dx - anchor.x;
			const dy = node.y + fold.dy - anchor.y;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
			// Branches collapsed inside this one are among its ids, so they move with it and stay in step.
			for (const hid of fold.ids) {
				const n = canvas.nodes.get(hid);
				if (n) moveBy(n, dx, dy);
			}
			moved = true;
		}
		if (moved) forgetBranches(canvas);
		return moved;
	}

	// ---------- Fitting nodes to their text ----------

	private fitTimers = new Map<CanvasNode, number>();

	/** Typing in a mind map node: resize it (debounced) and, with auto layout, re-flow its tree. */
	private onEditorChanged(view: EditorView) {
		if (!this.settings.autoSize) return;
		const node = this.nodeForEditor(view);
		if (!node || node.canvas.readonly || !node.canvas.getEdgesForNode(node).length) return;
		window.clearTimeout(this.fitTimers.get(node));
		this.fitTimers.set(
			node,
			window.setTimeout(() => {
				this.fitTimers.delete(node);
				if (!this.fit(node, view.state.doc.toString())) return;
				const parent = parentOf(node);
				if (this.settings.autoLayout && (parent || outgoing(node).length)) this.layout(rootOf(node));
				node.canvas.requestSave();
			}, 120),
		);
	}

	/** Resize a plain-text node to its text. Returns true if its size changed. */
	fit(node: CanvasNode, text = node.text): boolean {
		if (typeof text !== "string" || node.getData().type !== "text") return false;
		const size = this.measure(node.canvas, text);
		if (!size || (Math.abs(size.width - node.width) < 1 && Math.abs(size.height - node.height) < 1)) return false;
		// Keep the vertical centre, so edges and siblings move as little as possible.
		const y = node.y + (node.height - size.height) / 2;
		node.moveAndResize({ x: node.x, y, width: size.width, height: size.height });
		return true;
	}

	/** Sizes already measured, by maximum width and text: measuring forces the browser to lay the page out. */
	private sizeCache = new Map<string, Size>();

	/**
	 * Size of a text node showing `text`, measured with a hidden copy of the node's own DOM inside the
	 * canvas so the theme's fonts and paddings apply. Null for text this can't measure faithfully.
	 */
	measure(canvas: Canvas, text: string): Size | null {
		const plain = plainText(text);
		if (plain === null) return null;
		// A hidden canvas (background tab, another workspace, a window being restored) has no layout:
		// every width reads 0 and the node would be shrunk to the 80x60 minimum. Measure nothing then.
		if (!canvas.canvasEl.isShown()) return null;
		const key = `${this.settings.maxWidth}\n${plain}`;
		const known = this.sizeCache.get(key);
		if (known) return { ...known };
		const live = this.liveParagraph(canvas);
		const size = live ? this.measureBeside(live, plain) : this.measureDetached(canvas, plain);
		if (size) {
			if (this.sizeCache.size > 5000) this.sizeCache.clear();
			this.sizeCache.set(key, { ...size });
		}
		return size;
	}

	/** measure() with a stand-in node, for a canvas showing no text node to measure beside. */
	private measureDetached(canvas: Canvas, plain: string): Size | null {
		const host = canvas.canvasEl.createDiv({ cls: "canvas-node arbor-measure" });
		try {
			const container = host.createDiv({ cls: "canvas-node-container" });
			// The container is absolutely positioned (so the host itself is always 0x0) and 4000px wide
			// by our CSS: zero here means there is no layout at all.
			if (!container.offsetWidth) return null;
			const preview = container
				.createDiv({ cls: "canvas-node-content markdown-embed" })
				.createDiv({ cls: "markdown-embed-content" })
				.createDiv({ cls: "markdown-preview-view markdown-rendered" });
			const p = preview.createDiv({ cls: "markdown-preview-sizer markdown-preview-section" }).createEl("p", { text: plain || " " });

			const cs = getComputedStyle(preview);
			const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
			const border = container.offsetWidth - container.clientWidth || 2;
			const padY = 32; // a one-line node is the native 60px tall

			p.addClass("arbor-measure-natural");
			const natural = p.offsetWidth + 2; // a little slack so the line never wraps from rounding
			p.removeClass("arbor-measure-natural");
			p.addClass("arbor-measure-word");
			const word = p.offsetWidth + 2;
			p.removeClass("arbor-measure-word");
			const contentWidth = this.contentWidth(natural, word, padX + border);
			p.addClass("arbor-measure-wrap");
			p.setCssStyles({ width: `${contentWidth}px` });
			const height = p.offsetHeight;

			return {
				// An empty node stays wide enough to read as a box to type into.
				width: Math.max(plain ? 80 : 120, Math.ceil(contentWidth + padX + border)),
				height: Math.max(60, Math.ceil(height + padY)),
			};
		} finally {
			host.remove();
		}
	}

	/** Words are never split: below the longest word the node grows instead, even past the max width. */
	private contentWidth(natural: number, word: number, chromeX: number): number {
		return Math.max(word, Math.min(natural, Math.max(40, this.settings.maxWidth - chromeX)));
	}

	/**
	 * A paragraph of a text node that is on screen, not being edited and not scrolling. Measuring next to
	 * it gives exactly the font and paddings real nodes use, whatever the theme or Obsidian version.
	 */
	private liveParagraph(canvas: Canvas): { node: CanvasNode; p: HTMLElement } | null {
		for (const node of canvas.nodes.values()) {
			if (node.isEditing || node.getData().type !== "text" || hooks.hidden(node)) continue;
			const p = node.nodeEl.querySelector<HTMLElement>(".markdown-preview-sizer > .el-p > p");
			const view = p?.closest<HTMLElement>(".markdown-preview-view");
			if (!p || !view || !p.offsetWidth || !node.nodeEl.offsetWidth) continue;
			if (view.scrollHeight > view.clientHeight + 1) continue; // a scrollbar would count as padding
			return { node, p };
		}
		return null;
	}

	/** measure() using a hidden paragraph placed beside a real one, so it inherits the real styles. */
	private measureBeside(live: { node: CanvasNode; p: HTMLElement }, plain: string): Size {
		// Everything around the text: node border, content and preview paddings, as rendered right now.
		const chromeX = live.node.nodeEl.offsetWidth - live.p.offsetWidth;
		const probe = (live.p.parentElement as HTMLElement).createEl("p", { text: plain || " " });
		probe.addClass("arbor-probe");
		try {
			probe.addClass("arbor-probe-natural");
			const natural = probe.offsetWidth + 2; // a little slack so the line never wraps from rounding
			probe.removeClass("arbor-probe-natural");
			probe.addClass("arbor-probe-word");
			const word = probe.offsetWidth + 2;
			probe.removeClass("arbor-probe-word");
			const contentWidth = this.contentWidth(natural, word, chromeX);
			probe.addClass("arbor-probe-wrap");
			probe.setCssProps({ "--arbor-probe-width": `${contentWidth}px` });
			const height = probe.offsetHeight;
			return {
				width: Math.max(plain ? 80 : 120, Math.ceil(contentWidth + chromeX)),
				height: Math.max(60, Math.ceil(height + 32)), // a one-line node is the native 60px tall
			};
		} finally {
			probe.remove();
		}
	}

	// ---------- Adding nodes ----------

	private paint(node: CanvasNode, color: string | undefined) {
		if (!color) return;
		if (node.setColor) node.setColor(color);
		else node.setData?.({ ...node.getData(), color });
	}

	add(from: CanvasNode, action: Action) {
		const canvas = from.canvas;
		if (from.isEditing) from.blur();
		// A new child of a collapsed branch would be born hidden.
		if (action === "child" && hooks.collapsed(from)) this.expand(from);
		const parent = action === "child" ? from : parentOf(from);
		if (this.settings.autoSize) this.fit(from);

		const size = (this.settings.autoSize && this.measure(canvas, "")) || { ...canvas.config.defaultTextNodeDimensions };
		// Which way the new node goes from its parent: a sibling follows `from`, a child its parent's branch.
		const dir: Dir = !parent ? "right" : action === "child" ? this.growDir(from) : dirFrom(parent, from);
		// Start on the right side of the parent, so the arrow never reads as one pointing back.
		const { hGap, vGap } = this.settings;
		let pos: { x: number; y: number };
		if (action === "child") {
			pos = dir === "down" ? { x: from.x, y: from.y + from.height + hGap } : dir === "left" ? { x: from.x - hGap - size.width, y: from.y } : { x: from.x + from.width + hGap, y: from.y };
		} else {
			pos = dir === "down" ? { x: from.x + from.width + vGap, y: from.y } : { x: from.x, y: from.y + from.height + vGap };
		}
		const node = canvas.createTextNode({ pos, size, text: "", focus: false, save: false });
		const inherit = this.settings.inheritColor;
		if (inherit) this.paint(node, from.color);

		if (parent) {
			const [fromSide, toSide] = SIDE_PAIR[dir];
			// The arrow into `from` gives the branch its colour.
			const above = inherit ? parentOf(from) : null;
			const color = (above && branchEdgeBetween(above, from)?.getData().color) || undefined;
			canvas.importData({
				nodes: [],
				edges: [{ id: randomId(), fromNode: parent.id, fromSide, toNode: node.id, toSide, ...(color ? { color } : {}) }],
			});
			forgetBranches(canvas);
		}

		if (parent && this.settings.autoLayout) {
			const root = rootOf(parent);
			const tree = this.layout(root, { insert: { node, after: action === "sibling" ? from : null } });
			// A new branch of the central node: from the threshold on, the map is kept even on both sides.
			if (parent === root && this.balances(root, tree)) this.balance(root, tree);
		} else {
			this.placeFreely(node, from, action, dir);
		}

		canvas.requestSave();
		// Focus after the current key event has finished, or the old editor keeps it.
		window.setTimeout(() => {
			// Same steps as the native createTextNode({ focus: true }): the editor only exists once rendered.
			node.attach();
			node.render();
			canvas.selectOnly(node);
			node.startEditing();
			canvas.panIntoView(node.getBBox());
		}, 0);
	}

	/** Without auto layout: put the node next to its relatives, then step down past anything in the way. */
	private placeFreely(node: CanvasNode, from: CanvasNode, action: Action, dir: Dir = "right") {
		const { hGap, vGap } = this.settings;
		const inTheWay = (x: number, y: number) =>
			node.canvas.getIntersectingNodes(bboxOf({ x, y, width: node.width, height: node.height })).filter((n) => n !== node && !isGroup(n) && !hooks.hidden(n));
		let x: number;
		let y: number;
		if (dir === "down") {
			// Downward map: children in a row under the parent, siblings to the right; step right past anything in the way.
			x = action === "child" ? from.x : from.x + from.width + vGap;
			y = action === "child" ? from.y + from.height + hGap : from.y;
			for (let i = 0; i < 200; i++) {
				const hits = inTheWay(x, y);
				if (!hits.length) break;
				x = Math.max(...hits.map((n) => n.x + n.width)) + vGap;
			}
			node.moveAndResize({ x, y, width: node.width, height: node.height });
			return;
		}
		const tree = buildTree(from);
		if (action === "child") {
			const siblings = (tree.get(from) ?? []).filter((c) => c !== node);
			x = dir === "left" ? from.x - hGap - node.width : from.x + from.width + hGap;
			y = siblings.length ? subtreeBottom(siblings[siblings.length - 1], tree) + vGap : from.y + (from.height - node.height) / 2;
		} else {
			x = from.x;
			y = subtreeBottom(from, tree) + vGap;
		}
		for (let i = 0; i < 200; i++) {
			const hits = inTheWay(x, y);
			if (!hits.length) break;
			y = Math.max(...hits.map((n) => n.y + n.height)) + vGap;
		}
		node.moveAndResize({ x, y, width: node.width, height: node.height });
	}

	// ---------- Layout ----------

	/** A node's size in the layout frame (see layout.ts): across the page for a downward map. */
	private sizer(down: boolean): (n: CanvasNode) => NodeSize {
		return down ? (n) => ({ su: n.height, sv: n.width, pre: 0, lead: labelSpace(n) }) : (n) => ({ su: n.width, sv: n.height, pre: labelSpace(n), lead: 0 });
	}

	private shapeOptions(down: boolean) {
		const { hGap, vGap, compact } = this.settings;
		return { hGap, sibGap: down ? Math.max(20, vGap * 2) : vGap, compact };
	}

	/**
	 * Lay out a whole map around its root, which never moves. The structure is read from the map unless
	 * `groups` says explicitly which root branches go which way (balancing, switching structure).
	 * Returns the map's tree, siblings in the order they were laid out.
	 */
	layout(
		root: CanvasNode,
		opts: { insert?: { node: CanvasNode; after: CanvasNode | null }; groups?: { dir: Dir; kids: CanvasNode[] }[]; route?: boolean; tree?: Tree } = {},
	): Tree {
		const canvas = root.canvas;
		const tree = opts.tree ?? buildTree(root);
		let groups = opts.groups;
		// Siblings in reading order: left to right in a downward map, top to bottom otherwise.
		const structure = groups ? (groups.some((g) => g.dir === "down") ? "down" : "both") : opts.tree ? structureOf(root, tree) : readingOrder(root, tree);

		const insert = opts.insert;
		if (insert) {
			for (const kids of tree.values()) {
				const i = kids.indexOf(insert.node);
				if (i < 0) continue;
				kids.splice(i, 1);
				const at = insert.after ? kids.indexOf(insert.after) : -1;
				if (at >= 0) kids.splice(at + 1, 0, insert.node);
				else kids.push(insert.node);
			}
		}

		const rootKids = tree.get(root) ?? [];
		if (!groups) {
			if (structure === "down") groups = [{ dir: "down", kids: rootKids }];
			else if (structure === "right") groups = [{ dir: "right", kids: rootKids }];
			else {
				groups = [
					{ dir: "right", kids: rootKids.filter((k) => center(k) >= center(root)) },
					{ dir: "left", kids: rootKids.filter((k) => center(k) < center(root)) },
				];
			}
		}

		const kidsOf = (n: CanvasNode) => tree.get(n) ?? [];
		const dirs = new Map<CanvasNode, Dir>();
		for (const g of groups) {
			if (!g.kids.length) continue;
			const down = g.dir === "down";
			const rel = new Map<CanvasNode, Offset>();
			shapeOf(root, g.kids, kidsOf, this.sizer(down), this.shapeOptions(down), rel);
			for (const [n, p] of positions(g.kids, kidsOf, rel)) {
				let x: number;
				let y: number;
				if (down) {
					x = root.x + p.v;
					y = root.y + p.u;
				} else if (g.dir === "left") {
					x = root.x + root.width - p.u - n.width;
					y = root.y + p.v;
				} else {
					x = root.x + p.u;
					y = root.y + p.v;
				}
				if (Math.abs(n.x - x) > 0.5 || Math.abs(n.y - y) > 0.5) n.moveAndResize({ x, y, width: n.width, height: n.height });
				dirs.set(n, g.dir);
			}
		}
		this.straightenEdges(canvas, tree, dirs);
		this.syncFolds(canvas);
		if (opts.route !== false && this.settings.linkArrows && this.settings.routeLinks) this.routeLinks(canvas, new Set(tree.keys()));
		return tree;
	}

	/** Height (or width, downward) a root branch takes, with everything below it. */
	private branchSpan(k: CanvasNode, tree: Tree, down: boolean): number {
		const kidsOf = (n: CanvasNode) => tree.get(n) ?? [];
		return span(shapeOf(k, kidsOf(k), kidsOf, this.sizer(down), this.shapeOptions(down), new Map()));
	}

	/** Whether a map is one this plugin keeps balanced: enough central branches, and not a downward map. */
	private balances(root: CanvasNode, tree: Tree): boolean {
		const n = this.settings.balanceFrom;
		return n > 0 && (tree.get(root) ?? []).length >= n && structureOf(root, tree) !== "down";
	}

	/**
	 * Spread the root branches over both sides, keeping their clockwise order and evening out the two
	 * heights. When two splits are as even, the right side gets the extra branch.
	 */
	balance(root: CanvasNode, tree = buildTree(root), route = true) {
		const order = clockwise(root, tree.get(root) ?? []);
		if (order.length < 2) {
			this.layout(root, { tree, route });
			return;
		}
		const spans = order.map((k) => this.branchSpan(k, tree, false));
		const total = spans.reduce((a, b) => a + b, 0);
		let best = 1;
		let bestDiff = Infinity;
		let acc = 0;
		for (let k = 1; k < order.length; k++) {
			acc += spans[k - 1];
			const diff = Math.abs(acc - (total - acc));
			if (diff <= bestDiff + 0.5) {
				bestDiff = Math.min(diff, bestDiff);
				best = k;
			}
		}
		this.layout(root, {
			tree,
			route,
			groups: [
				{ dir: "right", kids: order.slice(0, best) },
				{ dir: "left", kids: order.slice(best).reverse() },
			],
		});
	}

	/** Switch a map to one structure, keeping the branches' clockwise order. */
	restructure(root: CanvasNode, to: "right" | "down") {
		const tree = buildTree(root);
		const kids = tree.get(root) ?? [];
		const order = structureOf(root, tree) === "down" ? [...kids].sort((a, b) => a.x - b.x) : clockwise(root, kids);
		this.layout(root, { groups: [{ dir: to, kids: order }] });
	}

	/** Which way new children of `node` grow: its branch's side, or the shorter side for a new root branch. */
	private growDir(node: CanvasNode): Dir {
		const root = rootOf(node);
		const tree = buildTree(root);
		const structure = structureOf(root, tree);
		if (structure === "down") return "down";
		if (structure === "right") return "right";
		if (node === root) {
			const kids = tree.get(root) ?? [];
			const reach = (side: CanvasNode[]) => side.reduce((a, k) => a + this.branchSpan(k, tree, false) + this.settings.vGap, 0);
			const right = kids.filter((k) => center(k) >= center(root));
			const left = kids.filter((k) => center(k) < center(root));
			return reach(left) < reach(right) ? "left" : "right";
		}
		return sideOf(node, root);
	}

	/**
	 * Reattach links (arrows that aren't branches) to the pair of sides whose curve crosses the fewest
	 * other nodes, then is shortest. The side pairs branches use stay reserved for them, so a link never turns into one.
	 * With `only`, just the links touching those nodes.
	 */
	routeLinks(canvas: Canvas, only?: Set<CanvasNode>) {
		const branchSet = new Set(branchEdges(canvas).values());
		let boxes: { node: CanvasNode; box: BBox }[] | null = null;
		const changed: unknown[] = [];
		for (const e of canvas.edges.values()) {
			const a = e.from.node;
			const b = e.to.node;
			if (branchSet.has(e) || !a || !b || a === b || isGroup(a) || isGroup(b) || hooks.hidden(a) || hooks.hidden(b)) continue;
			if (only && !only.has(a) && !only.has(b)) continue;
			// Most canvases have no links at all: only then is nothing gathered.
			boxes ??= [...canvas.nodes.values()].filter((n) => !isGroup(n) && !hooks.hidden(n)).map((node) => ({ node, box: bboxOf(node) }));
			const reach = linkReach(a, b);
			const boxA = bboxOf(a);
			const boxB = bboxOf(b);
			const near = boxes.filter((o) => o.node !== a && o.node !== b && overlaps(o.box, reach, 0));
			const score = (fs: Side, ts: Side) => {
				const pts = edgeCurve(a, fs, b, ts);
				let hits = 0;
				for (const o of near) if (pts.some((p) => inBox(p, o.box, 6))) hits++;
				// Curling back through its own ends is as bad as crossing a node.
				const inner = pts.slice(3, -3);
				if (inner.some((p) => inBox(p, boxA, -2))) hits++;
				if (inner.some((p) => inBox(p, boxB, -2))) hits++;
				let len = 0;
				for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
				return hits * 1e6 + len;
			};
			const current = SIDES.includes(e.from.side as Side) && SIDES.includes(e.to.side as Side) && !isBranchLook(e.from.side, e.to.side)
				? score(e.from.side as Side, e.to.side as Side)
				: Infinity;
			let best: [Side, Side] | null = null;
			let bestScore = Infinity;
			for (const fs of SIDES) {
				for (const ts of SIDES) {
					if (isBranchLook(fs, ts)) continue;
					const sc = score(fs, ts);
					if (sc < bestScore) {
						bestScore = sc;
						best = [fs, ts];
					}
				}
			}
			// Keep the current sides unless the new ones are clearly better, so links don't flicker.
			if (!best || bestScore >= current - 20) continue;
			changed.push({ ...e.getData(), fromSide: best[0], toSide: best[1] });
		}
		if (changed.length) {
			canvas.importData({ nodes: [], edges: changed });
			forgetBranches(canvas);
		}
	}

	/**
	 * Tidy the whole canvas: every tree is laid out again with its edges running right → left,
	 * trees are pushed apart so they don't overlap, and loose nodes sitting on top of a tree are moved below it.
	 */
	tidy(canvas: Canvas) {
		if (canvas.readonly) return;
		const { vGap } = this.settings;
		const gap = vGap * 3;

		const trees: CanvasNode[][] = [];
		for (const root of this.roots(canvas)) {
			const tree = buildTree(root);
			if (this.settings.autoSize) for (const n of tree.keys()) this.fit(n);
			// Links are routed once, below, when every tree is in its final place.
			if (this.balances(root, tree)) this.balance(root, tree, false);
			else this.layout(root, { route: false });
			trees.push([...tree.keys()]);
		}

		// Trees, top to bottom: push each one down until it clears the ones already placed.
		const placed: BBox[] = [];
		for (const members of trees) {
			let box = unionBox(members);
			for (;;) {
				const hit = placed.find((p) => overlaps(p, box, gap));
				if (!hit) break;
				const dy = hit.maxY + gap - box.minY;
				members.forEach((n) => moveBy(n, 0, dy));
				box = unionBox(members);
			}
			placed.push(box);
		}
		this.syncFolds(canvas);
		if (this.settings.linkArrows && this.settings.routeLinks) this.routeLinks(canvas);

		// Loose nodes (no edges at all) that ended up under a tree go below everything.
		const inTree = new Set(trees.flat());
		let bottom = placed.length ? Math.max(...placed.map((b) => b.maxY)) : 0;
		for (const n of canvas.nodes.values()) {
			if (inTree.has(n) || isGroup(n) || hooks.hidden(n) || canvas.getEdgesForNode(n).length) continue;
			const box = bboxOf(n);
			const under = placed.filter((p) => overlaps(p, box, 0));
			if (!under.length) continue;
			n.moveAndResize({ x: Math.min(...under.map((p) => p.minX)), y: bottom + gap, width: n.width, height: n.height });
			bottom = n.y + n.height;
		}
		canvas.requestSave();
	}

	/** Branch arrows follow their direction: right to left, left to right on the left half, bottom to top downward. */
	private straightenEdges(canvas: Canvas, tree: Tree, dirs: Map<CanvasNode, Dir>) {
		const branches = hooks.linkArrows() ? branchEdges(canvas) : null;
		const changed: unknown[] = [];
		for (const [parent, kids] of tree) {
			if (!kids.length) continue;
			const mine = new Set(kids);
			for (const e of canvas.getEdgesForNode(parent)) {
				if (e.from.node !== parent || !mine.has(e.to.node)) continue;
				if (branches && branches.get(e.to.node) !== e) continue; // links keep their sides
				const [fromSide, toSide] = SIDE_PAIR[dirs.get(e.to.node) ?? "right"];
				if (e.from.side === fromSide && e.to.side === toSide) continue;
				changed.push({ ...e.getData(), fromSide, toSide });
			}
		}
		if (changed.length) {
			canvas.importData({ nodes: [], edges: changed });
			forgetBranches(canvas);
		}
	}

	// ---------- Markdown lists ----------

	/** What "Copy map as Markdown list" starts from: the selected node, or every map on the canvas. */
	private outlineTops(canvas: Canvas): CanvasNode[] {
		const node = this.selectedNode(canvas);
		return node ? [node] : this.roots(canvas);
	}

	private outlineText(node: CanvasNode, canvasPath: string): string {
		const d = node.getData();
		if (d.type === "text") return (node.text ?? d.text ?? "").trim();
		if (node.file) return `[[${this.app.metadataCache.fileToLinktext(node.file, canvasPath)}]]`;
		return (d.url ?? d.file ?? d.label ?? "").trim();
	}

	private async copyOutline(canvas: Canvas) {
		const s = t();
		const path = this.viewOf(canvas)?.file?.path ?? "";
		this.syncFolds(canvas);
		// Collapsed branches are part of the map: everything is listed.
		const items = this.outlineTops(canvas).map((top) => {
			const tree = buildTree(top, true);
			const root = rootOf(top);
			if (structureOf(root, root === top ? tree : buildTree(root)) === "down") for (const kids of tree.values()) kids.sort((a, b) => a.x - b.x || a.y - b.y);
			const item = (n: CanvasNode): OutlineItem => ({ text: this.outlineText(n, path), children: (tree.get(n) ?? []).map(item) });
			return item(top);
		});
		try {
			await navigator.clipboard.writeText(formatOutline(items));
			new Notice(s.outlineCopied);
		} catch (e) {
			console.error("[canvas-arbor]", e);
			new Notice(s.clipboardFailed);
		}
	}

	/** The list on the clipboard becomes branches of the selected node, or new maps in the middle of the view. */
	private async pasteOutline(canvas: Canvas) {
		const s = t();
		let text: string;
		try {
			text = await navigator.clipboard.readText();
		} catch (e) {
			console.error("[canvas-arbor]", e);
			new Notice(s.clipboardFailed);
			return;
		}
		const items = parseOutline(text);
		if (!items.length) {
			new Notice(s.outlineEmpty);
			return;
		}
		const parent = this.singleSelected(canvas);
		if (parent?.isEditing) parent.blur();
		if (parent && hooks.collapsed(parent)) this.expand(parent);

		const { hGap, vGap, autoSize, inheritColor } = this.settings;
		const edges: unknown[] = [];
		const made: CanvasNode[] = [];
		// Siblings are ordered by where they sit, so every new node starts a little further along than the one before.
		let seq = 0;
		const make = (item: OutlineItem, from: CanvasNode | null, dir: Dir, start: { x: number; y: number }): CanvasNode => {
			const size = (autoSize && this.measure(canvas, item.text)) || { ...canvas.config.defaultTextNodeDimensions };
			seq++;
			let pos = { x: start.x, y: start.y + seq };
			if (from) {
				if (dir === "down") pos = { x: start.x + seq, y: from.y + from.height + hGap };
				else pos = { x: dir === "left" ? from.x - hGap - size.width : from.x + from.width + hGap, y: start.y + seq };
			}
			const node = canvas.createTextNode({ pos, size, text: item.text, focus: false, save: false });
			made.push(node);
			if (from) {
				const [fromSide, toSide] = SIDE_PAIR[dir];
				edges.push({ id: randomId(), fromNode: from.id, fromSide, toNode: node.id, toSide });
				if (inheritColor) this.paint(node, from.color);
			}
			for (const child of item.children) make(child, node, dir, pos);
			return node;
		};

		let tops: CanvasNode[];
		if (parent) {
			const dir = this.growDir(parent);
			// After the branches the node already has.
			const kids = outgoing(parent);
			const start = { x: Math.max(parent.x, ...kids.map((k) => k.x)), y: Math.max(parent.y, ...kids.map((k) => k.y)) };
			tops = items.map((item) => make(item, parent, dir, start));
		} else {
			const mid = canvas.posCenter?.() ?? { x: canvas.x ?? 0, y: canvas.y ?? 0 };
			tops = items.map((item) => make(item, null, "right", mid));
		}
		if (edges.length) canvas.importData({ nodes: [], edges });
		forgetBranches(canvas);

		if (parent) {
			this.layout(rootOf(parent));
		} else {
			// One map per top-level item, stacked from the middle of the view down.
			let top = tops[0].y;
			for (const root of tops) {
				const members = [...this.layout(root).keys()];
				const box = unionBox(members);
				const dy = top - box.minY;
				if (dy) members.forEach((n) => moveBy(n, 0, dy));
				top += box.maxY - box.minY + vGap * 3;
			}
		}
		canvas.requestSave();
		window.setTimeout(() => {
			canvas.selectOnly(parent ?? tops[0]);
			canvas.zoomToBbox(unionBox(parent ? [parent, ...made] : made));
			canvas.wrapperEl.focus();
		}, 0);
	}

	// ---------- Tidy button in the canvas controls (right-hand toolbar) ----------

	private findKeys = new Map<CanvasView, KeymapEventHandler[]>();

	/**
	 * Keys Obsidian hands out before any plugin listener sees them, claimed in the canvas view's own
	 * scope, which is asked first. Mod+F belongs to "Search current file". Shift+arrow is Canvas's
	 * own (a bigger nudge of the selection): a scope gives a key to its first handler only, so ours
	 * go in front and pass the key on to the native one when it is not for a mind map node.
	 */
	private claimKeys(view: CanvasView): KeymapEventHandler[] {
		const scope = view.scope;
		if (!scope) return [];
		const handlers = [
			scope.register(["Mod"], "f", () => {
				this.openSearch(view);
				return false;
			}),
		];
		const keys = (scope as unknown as { keys?: ScopeKey[] }).keys;
		if (!Array.isArray(keys)) return handlers;
		for (const key of ARROWS) {
			const native = keys.find((k) => k.key === key && k.modifiers === "Shift");
			const handler = scope.register(["Shift"], key, (evt, ctx) => {
				if (view.canvas && this.onArrow(evt, view.canvas)) return false;
				return native?.func(evt, ctx);
			});
			const i = keys.indexOf(handler as unknown as ScopeKey);
			if (i > 0) keys.unshift(...keys.splice(i, 1));
			handlers.push(handler);
		}
		return handlers;
	}

	private addTidyButtons() {
		// Forget canvases that have been closed, so their views (and everything they hold) can be freed.
		const views = this.canvasViews();
		const open = new Set(views);
		for (const [view, handlers] of this.findKeys) {
			if (open.has(view)) continue;
			for (const handler of handlers) view.scope?.unregister(handler);
			this.findKeys.delete(view);
		}
		for (const [view, search] of this.searches) if (!open.has(view)) search.close(false);
		for (const view of views) {
			if (view.scope && !this.findKeys.has(view)) this.findKeys.set(view, this.claimKeys(view));
			const controls = view.containerEl.querySelector(".canvas-controls");
			if (!view.canvas || !controls || controls.querySelector(".arbor-tidy")) continue;
			const group = createDiv({ cls: "canvas-control-group mod-raised arbor-tidy" });
			const searchItem = group.createDiv({ cls: "canvas-control-item" });
			setIcon(searchItem, "search");
			setTooltip(searchItem, `${t().searchTip} (${usesCmd() ? "⌘" : "Ctrl+"}F)`, { placement: "left" });
			searchItem.addEventListener("click", () => this.openSearch(view));
			const item = group.createDiv({ cls: "canvas-control-item" });
			setIcon(item, "list-tree");
			setTooltip(item, t().tidyTip, { placement: "left" });
			item.addEventListener("click", () => this.tidy(view.canvas));
			// After the zoom group, before undo / redo.
			const anchor = controls.children[2] ?? null;
			controls.insertBefore(group, anchor);
		}
	}

	// ---------- Search ----------

	searches = new Map<CanvasView, CanvasSearch>();

	openSearch(view: CanvasView) {
		let search = this.searches.get(view);
		if (!search) {
			search = new CanvasSearch(
				this.app,
				view,
				() => this.searches.delete(view),
				(node) => {
					if (!view.canvas.readonly) this.reveal(node);
				},
			);
			this.searches.set(view, search);
		}
		search.open();
	}

	// ---------- Renaming attachments pasted into a canvas ----------
	// Paste Image Rename only looks at Markdown views, so in a canvas it gives up ("No active file found").

	private onFileCreated(file: TAbstractFile) {
		if (!this.settings.renamePasted || !(file instanceof TFile)) return;
		if (file.extension === "md" || file.extension === "canvas") return;
		if (Date.now() - file.stat.ctime > 1000) return;
		const view = this.activeCanvasView();
		if (!view?.file) return;
		void this.renameIfUsedBy(file, view.canvas, view.file);
	}

	private async renameIfUsedBy(file: TFile, canvas: Canvas, canvasFile: TFile) {
		const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
		const originalPath = file.path;
		const oldName = file.name;
		const usedByCanvas = () => {
			for (const n of canvas.nodes.values()) if (n.file === file || (typeof n.text === "string" && mentions(n.text, oldName))) return true;
			return false;
		};

		// Only touch files this canvas adopts within a few seconds; anything else (sync, other plugins) is left alone.
		let deadline = Date.now() + 5000;
		while (!usedByCanvas()) {
			if (Date.now() >= deadline) return;
			await sleep(100);
		}
		if (file.path !== originalPath || this.app.vault.getAbstractFileByPath(originalPath) !== file) return; // someone else moved it

		const target = this.uniquePath(file, canvasFile.basename);
		const s = t();
		try {
			await this.app.fileManager.renameFile(file, target);
		} catch (e) {
			console.error("[canvas-arbor]", e);
			new Notice(`${s.renameFailed}: ${file.name}`);
			return;
		}
		deadline = Date.now() + 5000;
		while (this.app.vault.getAbstractFileByPath(target) !== file) {
			if (Date.now() >= deadline) {
				new Notice(`${s.renameFailed}: ${file.name}`);
				return;
			}
			await sleep(25);
		}
		// File nodes hold the TFile, so their saved path is already right, but their label and image
		// still show the old name: the node only reloads when handed a different file. Force it.
		// Links inside text nodes are not updated by Obsidian at all, so rewrite them here —
		// through the editor if the node is open.
		for (const n of canvas.nodes.values()) {
			if (n.file === file) {
				n.setFile?.(file, n.subpath ?? "", true);
				n.unloadChild?.();
				canvas.markDirty(n);
				continue;
			}
			if (typeof n.text !== "string" || !mentions(n.text, oldName)) continue;
			const cm = n.isEditing ? n.child?.editor?.cm : undefined;
			if (cm) {
				const doc = cm.state.doc.toString();
				const changes = replacements(doc, oldName, file.name);
				if (changes.length) cm.dispatch({ changes });
			} else if (n.setText) {
				n.setText(applyReplacements(n.text, replacements(n.text, oldName, file.name)));
			}
		}
		canvas.requestFrame();
		canvas.requestSave();
		new Notice(`${s.renamed} ${file.name}`);
	}

	/**
	 * "<stem>.ext", then "<stem>-1.ext"… — a name no other file in the vault has, so a short link to it is never
	 * ambiguous. Asked of Obsidian's own link resolution (which finds a file by name anywhere), not by listing files.
	 */
	private uniquePath(file: TFile, stem: string): string {
		const folder = file.parent && !file.parent.isRoot() ? file.parent.path + "/" : "";
		for (let i = 0; ; i++) {
			const name = `${stem}${i ? `-${i}` : ""}.${file.extension}`;
			const path = normalizePath(folder + name);
			const sameName = this.app.metadataCache.getFirstLinkpathDest(name, "");
			if ((!sameName || sameName === file) && !this.app.vault.getAbstractFileByPath(path)) return path;
		}
	}

	// ---------- Copying an image node (desktop only) ----------

	/**
	 * Puts the image on the clipboard as PNG — the one image type the clipboard API takes — so a paste
	 * anywhere gets the full-size picture. PNGs go as they are; other formats are decoded and re-encoded.
	 */
	private async copyImage(file: TFile) {
		const s = t();
		try {
			const png = await this.toPng(file);
			await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
			new Notice(s.copied);
		} catch (e) {
			console.error("[canvas-arbor] copy failed", e);
			new Notice(s.copyFailed);
		}
	}

	/** Decoded from the file's bytes, not the <img> on the page: that one taints a canvas and refuses to export. */
	private async toPng(file: TFile): Promise<Blob> {
		const ext = file.extension.toLowerCase();
		const bytes = await this.app.vault.readBinary(file);
		if (ext === "png") return new Blob([bytes], { type: "image/png" });
		const type = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
		let source: ImageBitmap | HTMLImageElement;
		if (type === "image/svg+xml") {
			// createImageBitmap cannot decode SVG; an <img> from a blob URL can.
			const url = URL.createObjectURL(new Blob([bytes], { type }));
			const img = new Image();
			img.src = url;
			await img.decode().finally(() => URL.revokeObjectURL(url));
			source = img;
		} else {
			source = await createImageBitmap(new Blob([bytes], { type }));
		}
		const el = createEl("canvas");
		el.width = source.width;
		el.height = source.height;
		el.getContext("2d")?.drawImage(source, 0, 0);
		if (source instanceof ImageBitmap) source.close();
		const blob = await new Promise<Blob | null>((resolve) => el.toBlob(resolve, "image/png"));
		if (!blob) throw new Error("could not encode PNG");
		return blob;
	}

	// ---------- Buttons on the selected node ----------

	private patchMenuFromOpenCanvas() {
		if (this.restoreMenu) return;
		for (const view of this.canvasViews()) {
			if (view.canvas?.menu) {
				this.patchMenu(view.canvas.menu);
				return;
			}
		}
	}

	/** Wraps the selection menu's render, shared by every canvas. Other plugins may wrap it too, in any order. */
	private patchMenu(menu: CanvasMenu) {
		const decorate = (m: CanvasMenu) => this.decorateMenu(m);
		const unpatch = around(Object.getPrototypeOf(menu) as CanvasMenu, {
			render(next) {
				return function (this: CanvasMenu, ...args: unknown[]): unknown {
					const result: unknown = next.call(this, ...args);
					try {
						decorate(this);
					} catch (e) {
						console.error("[canvas-arbor]", e);
					}
					return result;
				};
			},
		});
		this.restoreMenu = () => {
			unpatch();
			for (const view of this.canvasViews()) view.canvas?.wrapperEl.querySelectorAll(".arbor-node-button").forEach((el) => el.remove());
		};
		menu.render(true);
	}

	/** Runs whenever the canvas redraws its selection menu, i.e. whenever the selection changes. */
	private decorateMenu(menu: CanvasMenu) {
		const canvas = menu.canvas;
		const node = canvas.isDragging ? null : this.singleSelected(canvas);
		const folded = !!node && hooks.collapsed(node);
		const canFold = folded || (!!node && outgoing(node).length > 0);
		canvas.wrapperEl.querySelectorAll(".arbor-node-button").forEach((el) => {
			// The collapse button is drawn again when the branch opens or closes.
			if (!node || el.parentElement !== node.nodeEl || (el.hasClass("arbor-fold") && (el.hasClass("is-folded") !== folded || !canFold))) el.remove();
		});
		if (!node) return;
		const s = t();
		const make = (cls: string, icon: string, tip: string, placement: "right" | "bottom" | "top", run: () => void) => {
			if (node.nodeEl.querySelector(`:scope > .${cls.split(" ").pop()}`)) return;
			const btn = node.nodeEl.createDiv({ cls: `arbor-node-button ${cls}`, attr: { role: "button" } });
			setIcon(btn, icon);
			setTooltip(btn, tip, { placement });
			// Keep the canvas from treating these as a drag, a selection change or a double-click on the node.
			for (const type of ["pointerdown", "mousedown", "dblclick"]) btn.addEventListener(type, (evt) => evt.stopPropagation());
			btn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				run();
			});
		};
		make("arbor-add arbor-add-child", "plus", s.childTip, "right", () => this.add(node, "child"));
		make("arbor-add arbor-add-sibling", "plus", s.siblingTip, "bottom", () => this.add(node, "sibling"));
		if (folded) make("arbor-add is-folded arbor-fold", "chevrons-up-down", s.expandTip, "top", () => this.expand(node));
		else if (canFold) make("arbor-add arbor-fold", "chevrons-down-up", s.collapseTip, "top", () => this.collapse(node));
		const file = node.file;
		if (file && IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) {
			make("arbor-copy", "copy", s.copyTip, "top", () => void this.copyImage(file));
		}
	}
}
