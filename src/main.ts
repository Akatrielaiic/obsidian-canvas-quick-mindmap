import { App, ItemView, KeymapEventHandler, Notice, SettingDefinitionItem, Platform, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, getLanguage, normalizePath, setIcon, setTooltip } from "obsidian";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ---------- Canvas internals (not part of the public API; shapes observed in Obsidian 1.14) ----------

interface BBox { minX: number; minY: number; maxX: number; maxY: number }

interface CanvasNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	isEditing: boolean;
	canvas: Canvas;
	nodeEl: HTMLElement;
	file?: TFile;
	text?: string;
	child?: { editor?: { cm?: EditorView }; editMode?: { focus(): void } };
	setText?(text: string): void;
	subpath?: string;
	setFile?(file: TFile, subpath: string, force: boolean): void;
	unloadChild?(): void;
	getData(): { type: string; text?: string; file?: string; label?: string; url?: string };
	moveAndResize(rect: { x: number; y: number; width: number; height: number }): void;
	attach(): void;
	render(): void;
	startEditing(): void;
	blur(): void;
	getBBox(): BBox;
}

interface CanvasEdge {
	id: string;
	from: { node: CanvasNode; side: string };
	to: { node: CanvasNode; side: string };
	getData(): { id: string; fromSide?: string; toSide?: string };
}

interface CanvasMenu {
	canvas: Canvas;
	menuEl: HTMLElement;
	render: (this: CanvasMenu, ...args: unknown[]) => unknown;
}

interface Canvas {
	nodes: Map<string, CanvasNode>;
	edges: Map<string, CanvasEdge>;
	selection: Set<CanvasNode>;
	readonly: boolean;
	isDragging: boolean;
	wrapperEl: HTMLElement;
	canvasEl: HTMLElement;
	menu: CanvasMenu;
	config: { defaultTextNodeDimensions: { width: number; height: number } };
	getEdgesForNode(node: CanvasNode): CanvasEdge[];
	getIntersectingNodes(bbox: BBox): CanvasNode[];
	createTextNode(opts: {
		pos: { x: number; y: number };
		size: { width: number; height: number };
		text: string;
		focus: boolean;
		save: boolean;
	}): CanvasNode;
	importData(data: { nodes: unknown[]; edges: unknown[] }): void;
	selectOnly(node: CanvasNode): void;
	requestSave(): void;
	markDirty(node: CanvasNode): void;
	requestFrame(): void;
	panIntoView(bbox: BBox): void;
	panTo(x: number, y: number): void;
	zoomToBbox(bbox: BBox): void;
	zoom: number;
	zoomBreakpoint: number;
}

interface CanvasView extends ItemView {
	canvas: Canvas;
	file: TFile | null;
}

// ---------- Settings & strings ----------

interface Settings {
	autoLayout: boolean;
	enterInEdit: boolean;
	tabAddsChild: boolean;
	mobileKeys: boolean;
	linkArrows: boolean;
	routeLinks: boolean;
	compact: boolean;
	balanceFrom: number;
	hGap: number;
	vGap: number;
	renamePasted: boolean;
	autoSize: boolean;
	maxWidth: number;
}

const DEFAULT_SETTINGS: Settings = {
	autoLayout: true,
	enterInEdit: true,
	tabAddsChild: false,
	mobileKeys: false,
	linkArrows: true,
	routeLinks: true,
	compact: true,
	balanceFrom: 5,
	hGap: 160,
	vGap: 20,
	renamePasted: true,
	autoSize: true,
	maxWidth: 320,
};

const STRINGS = {
	en: {
		addChild: "Add child node",
		addSibling: "Add sibling node",
		selectParent: "Select parent node",
		relayout: "Tidy mind map layout",
		tidyTip: "Tidy mind map",
		search: "Search canvas",
		searchTip: "Search canvas",
		searchPlaceholder: "Search this canvas…",
		searchPrev: "Previous",
		searchNext: "Next",
		searchClose: "Close search",
		searchNone: "No results",
		childTip: "Add child",
		siblingTip: "Add sibling",
		autoLayout: "Auto layout",
		autoLayoutDesc: "After adding a node, rearrange the whole branch tree so nodes never overlap. Turn off to keep your manual positions; new nodes are then placed in the nearest free spot.",
		enterInEdit: "Enter adds a node while typing",
		enterInEditDesc: "While editing a node, Enter adds a node (child or sibling, see the next setting) and Shift+Enter inserts a line break. Turn off to keep Enter as a line break. On phones and tablets this needs \"Keyboard shortcuts on mobile\".",
		mobileKeys: "Keyboard shortcuts on mobile",
		mobileKeysDesc: "For phones and tablets with a hardware keyboard: Enter while typing adds a node, as on desktop. Leave off with the on-screen keyboard, where Enter should stay a line break.",
		tabAddsChild: "Tab adds a child, Enter a sibling",
		tabAddsChildDesc: "While typing in a node, Tab goes one level deeper and Enter adds the next node on the same level, as in most mind map apps. Off: Enter adds a child and Tab a sibling.",
		linkArrows: "Extra arrows are links",
		linkArrowsDesc: "A node with several incoming arrows keeps one as its branch (the right-to-left one, else the one from a node on its left, else the oldest); the others, and arrows pointing back to the left, are links: layout and tidy ignore them. Off: every arrow is a branch, as before.",
		routeLinks: "Route links around nodes",
		routeLinksDesc: "After layout and tidy, links (see above) are reattached to the sides that keep them short and off other nodes. Needs \"Extra arrows are links\".",
		compact: "Compact layout",
		compactDesc: "Branches fit into each other's free space instead of each taking a full-height band.",
		balanceFrom: "Two sides from this many branches",
		balanceFromDesc: "When the central node gets this many branches, the map spreads them on both sides (once: if you move them back to one side, it stays). 0 never balances.",
		balance: "Balance map on both sides",
		growRight: "Map grows to the right",
		growDown: "Map grows downward",
		hGap: "Horizontal gap",
		hGapDesc: "Distance between a node and its children, in pixels. Below 160, Obsidian's curved edges start to loop back and cross each other.",
		vGap: "Vertical gap",
		vGapDesc: "Distance between sibling branches, in pixels.",
		renamePasted: "Rename attachments pasted into a canvas",
		renamePastedDesc: "Images and other files pasted or dropped into a canvas are renamed after the canvas (\"My map.png\", \"My map-1.png\"…), like Paste Image Rename does in notes. Only files the canvas actually uses are touched.",
		renamed: "Renamed to",
		renameFailed: "Could not rename",
		autoSize: "Fit nodes to their text",
		autoSizeDesc: "Mind map nodes (text nodes with an edge) grow and shrink with their text while you type, and when you add nodes or tidy. Nodes with images, code blocks, tables or headings keep their size.",
		maxWidth: "Maximum node width",
		maxWidthDesc: "Longer text wraps onto more lines instead of widening the node.",
		copyTip: "Copy image",
		copied: "Image copied",
		copyFailed: "Could not copy the image",
	},
	zh: {
		addChild: "添加子节点",
		addSibling: "添加同级节点",
		selectParent: "选中父节点",
		relayout: "整理导图布局",
		tidyTip: "整理导图",
		search: "搜索画布",
		searchTip: "搜索画布",
		searchPlaceholder: "搜索这个画布…",
		searchPrev: "上一个",
		searchNext: "下一个",
		searchClose: "关闭搜索",
		searchNone: "无结果",
		childTip: "添加子节点",
		siblingTip: "添加同级节点",
		autoLayout: "自动排版",
		autoLayoutDesc: "添加节点后，把整棵树重新排一遍，节点不会重叠。关掉则保留你手动摆的位置，新节点放在最近的空位。",
		enterInEdit: "输入时 Enter 新建节点",
		enterInEditDesc: "编辑节点时，Enter 新建节点（子节点或同级节点，见下一项），Shift+Enter 换行。关掉则 Enter 照常换行。手机和平板上需要同时打开「移动端键盘快捷键」。",
		mobileKeys: "移动端键盘快捷键",
		mobileKeysDesc: "手机或平板接了实体键盘时：输入时 Enter 新建节点，和电脑上一样。只用屏幕键盘时请关闭，让 Enter 保持换行。",
		tabAddsChild: "Tab 新建子节点，Enter 新建同级节点",
		tabAddsChildDesc: "输入时 Tab 往下一层，Enter 在同一层新建节点，和大多数思维导图软件一样。关掉则 Enter 新建子节点、Tab 新建同级节点。",
		linkArrows: "多余的连线视为关联线",
		linkArrowsDesc: "节点有多条连入的连线时，只保留一条作为分支（优先从右到左的那条，其次来自左侧节点的，再次最早的）；其余的以及指向左边的连线都是关联线，布局和整理时忽略。关掉则所有连线都当作分支，和以前一样。",
		routeLinks: "关联线绕开节点",
		routeLinksDesc: "布局和整理后，关联线（见上一项）重新接到让它最短、且不穿过其他节点的边上。需要打开「多余的连线视为关联线」。",
		compact: "紧凑布局",
		compactDesc: "分支互相利用空隙，而不是各自占满整条高度。",
		balanceFrom: "分支达到此数量时两侧分布",
		balanceFromDesc: "中心节点的分支达到这个数量时，导图自动分布到左右两侧（只做一次：如果你把它们移回一侧，就保持不变）。0 表示从不。",
		balance: "导图左右平衡",
		growRight: "导图向右展开",
		growDown: "导图向下展开",
		hGap: "水平间距",
		hGapDesc: "节点和子节点之间的距离（像素）。小于 160 时，Obsidian 的弯曲连线会往回绕，看起来互相交叉。",
		vGap: "垂直间距",
		vGapDesc: "同级分支之间的距离（像素）。",
		renamePasted: "按画布名重命名粘贴的附件",
		renamePastedDesc: "粘贴或拖进画布的图片等附件，按画布名重命名（「导图.png」「导图-1.png」…），和笔记里 Paste Image Rename 的效果一样。只处理画布里真的用到的文件。",
		renamed: "已重命名为",
		renameFailed: "重命名失败",
		autoSize: "节点大小跟随文字",
		autoSizeDesc: "导图里的节点（有连线的文本节点）在输入、添加节点和整理时自动调整宽高以适应文字。含图片、代码块、表格、标题的节点不动。",
		maxWidth: "节点最大宽度",
		maxWidthDesc: "文字再长就换行，节点变高而不是继续变宽。",
		copyTip: "复制图片",
		copied: "已复制图片",
		copyFailed: "复制图片失败",
	},
};

type Strings = typeof STRINGS.en;

function t(): Strings {
	return getLanguage().startsWith("zh") ? STRINGS.zh : STRINGS.en;
}

type Action = "child" | "sibling";

function randomId(): string {
	let s = "";
	for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
	return s;
}

function isGroup(node: CanvasNode): boolean {
	return node.getData().type === "group";
}

function bboxOf(n: { x: number; y: number; width: number; height: number }): BBox {
	return { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height };
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

/**
 * Text as it reads on screen, for measuring. Null when the node holds something that renders much
 * bigger or differently than its characters (embeds, code, tables, headings, maths).
 */
function plainText(md: string): string | null {
	if (/!\[|```|~~~|\$\$|^\s*\||^\s*#{1,6}\s/m.test(md)) return null;
	return md
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => target.split("#")[0].split("/").pop() ?? target)
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^(\s*)[-*+] \[[ xX]\] /gm, "$1☐ ")
		.replace(/^(\s*)[-*+] /gm, "$1• ")
		.replace(/^\s*> ?/gm, "")
		.replace(/(\*\*|__|~~|==|`)/g, "")
		.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1$2")
		.replace(/\n+$/, "");
}

// ---------- Link text helpers ----------

/** Names appear raw in wikilinks and URL-encoded in Markdown links. */
function nameForms(oldName: string, newName: string): [string, string][] {
	const forms: [string, string][] = [[oldName, newName]];
	if (encodeURI(oldName) !== oldName) forms.push([encodeURI(oldName), encodeURI(newName)]);
	return forms;
}

/** Characters that can sit right before / after a file name inside a wikilink or Markdown link. */
const LINK_BEFORE = new Set(["[", "/", "(", "<"]);
const LINK_AFTER = new Set(["]", "|", "#", ")", ">", "^"]);

/** Occurrences of `name` that are a whole link target, not part of a longer name ("1.png" inside "image-1.png"). */
function linkOccurrences(text: string, name: string): number[] {
	const out: number[] = [];
	for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + name.length)) {
		const before = text[i - 1];
		const after = text[i + name.length];
		if (LINK_BEFORE.has(before) && (after === undefined || LINK_AFTER.has(after))) out.push(i);
	}
	return out;
}

function mentions(text: string, name: string): boolean {
	return nameForms(name, name).some(([from]) => linkOccurrences(text, from).length > 0);
}

function replacements(text: string, oldName: string, newName: string): { from: number; to: number; insert: string }[] {
	const out: { from: number; to: number; insert: string }[] = [];
	for (const [from, to] of nameForms(oldName, newName)) {
		for (const i of linkOccurrences(text, from)) out.push({ from: i, to: i + from.length, insert: to });
	}
	return out.sort((a, b) => a.from - b.from);
}

function applyReplacements(text: string, changes: { from: number; to: number; insert: string }[]): string {
	let result = "";
	let pos = 0;
	for (const c of changes) {
		result += text.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return result + text.slice(pos);
}

// ---------- Geometry helpers ----------

/** File nodes (images, notes) show their file name above the box. */
function labelSpace(n: CanvasNode): number {
	return n.file ? 30 : 0;
}

function unionBox(nodes: CanvasNode[]): BBox {
	return {
		minX: Math.min(...nodes.map((n) => n.x)),
		minY: Math.min(...nodes.map((n) => n.y - labelSpace(n))),
		maxX: Math.max(...nodes.map((n) => n.x + n.width)),
		maxY: Math.max(...nodes.map((n) => n.y + n.height)),
	};
}

function overlaps(a: BBox, b: BBox, margin: number): boolean {
	return a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minY < b.maxY + margin && b.minY < a.maxY + margin;
}

function moveBy(n: CanvasNode, dx: number, dy: number) {
	n.moveAndResize({ x: n.x + dx, y: n.y + dy, width: n.width, height: n.height });
}

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const SIDE_DIR: Record<Side, { x: number; y: number }> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

function sidePoint(n: CanvasNode, side: Side): { x: number; y: number } {
	const cx = n.x + n.width / 2;
	const cy = n.y + n.height / 2;
	return { x: cx + (SIDE_DIR[side].x * n.width) / 2, y: cy + (SIDE_DIR[side].y * n.height) / 2 };
}

/** Points along the curve Obsidian draws for an edge: a cubic Bézier leaving each side along its normal. */
function edgeCurve(a: CanvasNode, fs: Side, b: CanvasNode, ts: Side, steps = 24): { x: number; y: number }[] {
	const p0 = sidePoint(a, fs);
	const p3 = sidePoint(b, ts);
	const pull = Math.min(150, Math.max(40, Math.hypot(p3.x - p0.x, p3.y - p0.y) / 2));
	const p1 = { x: p0.x + SIDE_DIR[fs].x * pull, y: p0.y + SIDE_DIR[fs].y * pull };
	const p2 = { x: p3.x + SIDE_DIR[ts].x * pull, y: p3.y + SIDE_DIR[ts].y * pull };
	const pts: { x: number; y: number }[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const u = 1 - t;
		pts.push({
			x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
			y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
		});
	}
	return pts;
}

/** Area any curve between two nodes can sweep, with room for the side pulls. */
function linkReach(a: CanvasNode, b: CanvasNode): BBox {
	return {
		minX: Math.min(a.x, b.x) - 160,
		minY: Math.min(a.y, b.y) - 160,
		maxX: Math.max(a.x + a.width, b.x + b.width) + 160,
		maxY: Math.max(a.y + a.height, b.y + b.height) + 160,
	};
}

function inBox(p: { x: number; y: number }, box: BBox, pad: number): boolean {
	return p.x > box.minX - pad && p.x < box.maxX + pad && p.y > box.minY - pad && p.y < box.maxY + pad;
}

// ---------- Tree helpers ----------

/** Set from the plugin: whether extra arrows are links (see branchEdges) or every arrow is a branch. */
let linkArrows = (): boolean => true;

/** The arrow that makes a node's branch, per node. Computed once per task (and after our own edge edits). */
const branchCache = new WeakMap<Canvas, Map<CanvasNode, CanvasEdge>>();

function forgetBranches(canvas: Canvas) {
	branchCache.delete(canvas);
}

function center(n: CanvasNode): number {
	return n.x + n.width / 2;
}

function middle(n: CanvasNode): number {
	return n.y + n.height / 2;
}

/** The side pairs branches use: right to left, left to right (left half of a map), bottom to top (downward map). */
function isBranchLook(fromSide: string, toSide: string): boolean {
	return (fromSide === "right" && toSide === "left") || (fromSide === "left" && toSide === "right") || (fromSide === "bottom" && toSide === "top");
}

/** An arrow going back toward where branches come from: never a branch. */
function pointsBack(e: CanvasEdge): boolean {
	const from = e.from.node;
	const to = e.to.node;
	if (e.from.side === "left" && e.to.side === "right") return center(to) > center(from);
	if (e.from.side === "bottom" && e.to.side === "top") return middle(to) < middle(from);
	return center(to) < center(from);
}

/**
 * Every node gets at most one branch arrow, the one ranking first among its incoming arrows:
 * right side to left side (what this plugin draws), then from a node on its left, then the oldest.
 * Arrows pointing back to the left, or that would close a loop, are never branches. Everything else is a link.
 */
function branchEdges(canvas: Canvas): Map<CanvasNode, CanvasEdge> {
	const cached = branchCache.get(canvas);
	if (cached) return cached;
	const order = new Map<CanvasEdge, number>();
	const candidates: CanvasEdge[] = [];
	for (const e of canvas.edges.values()) {
		order.set(e, order.size);
		const from = e.from.node;
		const to = e.to.node;
		if (!from || !to || from === to || isGroup(from) || isGroup(to)) continue;
		if (pointsBack(e)) continue; // a link
		candidates.push(e);
	}
	const rank = (e: CanvasEdge) => [
		isBranchLook(e.from.side, e.to.side) ? 0 : 1,
		center(e.from.node) < center(e.to.node) ? 0 : 1,
		order.get(e) as number,
	];
	candidates.sort((a, b) => {
		const ra = rank(a);
		const rb = rank(b);
		return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
	});
	const branch = new Map<CanvasNode, CanvasEdge>();
	for (const e of candidates) {
		const child = e.to.node;
		if (branch.has(child)) continue;
		// Walking up from the new parent must not reach the child.
		let cur: CanvasNode | undefined = e.from.node;
		while (cur && cur !== child) cur = branch.get(cur)?.from.node;
		if (cur === child) continue;
		branch.set(child, e);
	}
	branchCache.set(canvas, branch);
	queueMicrotask(() => branchCache.delete(canvas));
	return branch;
}

function parentOf(node: CanvasNode): CanvasNode | null {
	if (linkArrows()) return branchEdges(node.canvas).get(node)?.from.node ?? null;
	const edge = node.canvas.getEdgesForNode(node).find((e) => e.to.node === node && e.from.node !== node && !isGroup(e.from.node));
	return edge ? edge.from.node : null;
}

function outgoing(node: CanvasNode): CanvasNode[] {
	const out: CanvasNode[] = [];
	const branches = linkArrows() ? branchEdges(node.canvas) : null;
	for (const e of node.canvas.getEdgesForNode(node)) {
		const target = e.to.node;
		if (e.from.node !== node || target === node || isGroup(target) || out.includes(target)) continue;
		if (branches && branches.get(target) !== e) continue; // a link, not one of this node's branches
		out.push(target);
	}
	return out;
}

function rootOf(node: CanvasNode): CanvasNode {
	const seen = new Set<CanvasNode>([node]);
	let cur = node;
	for (;;) {
		const p = parentOf(cur);
		if (!p || seen.has(p)) return cur;
		seen.add(p);
		cur = p;
	}
}

/** Children of every node in the tree under `root`, each node claimed once (breadth first), ordered top to bottom. */
function buildTree(root: CanvasNode): Map<CanvasNode, CanvasNode[]> {
	const tree = new Map<CanvasNode, CanvasNode[]>();
	const claimed = new Set<CanvasNode>([root]);
	const queue = [root];
	while (queue.length) {
		const n = queue.shift() as CanvasNode;
		const kids = outgoing(n).filter((c) => !claimed.has(c));
		kids.sort((a, b) => a.y - b.y || a.x - b.x);
		kids.forEach((c) => claimed.add(c));
		tree.set(n, kids);
		queue.push(...kids);
	}
	return tree;
}

function subtreeBottom(node: CanvasNode, tree: Map<CanvasNode, CanvasNode[]>): number {
	let bottom = node.y + node.height;
	for (const c of tree.get(node) ?? []) bottom = Math.max(bottom, subtreeBottom(c, tree));
	return bottom;
}

// ---------- Map structures ----------

/** Sides a branch arrow uses, by the direction its child grows. */
const SIDE_PAIR: Record<"right" | "left" | "down", [string, string]> = { right: ["right", "left"], left: ["left", "right"], down: ["bottom", "top"] };

/** Which way a node's children grow. */
type Dir = "right" | "left" | "down";
/** How a whole map is laid out: all to the right, on both sides of the root, or downward like an org chart. */
type Structure = "right" | "both" | "down";

/** The branch arrow from parent to child, if there is one. */
function branchEdgeBetween(parent: CanvasNode, child: CanvasNode): CanvasEdge | undefined {
	if (linkArrows()) {
		const e = branchEdges(child.canvas).get(child);
		return e && e.from.node === parent ? e : undefined;
	}
	return parent.canvas.getEdgesForNode(parent).find((e) => e.from.node === parent && e.to.node === child);
}

/** Read from the map itself, nothing is stored: arrows leaving the root from below mean downward, branches left of the root mean both sides. */
function structureOf(root: CanvasNode, tree: Map<CanvasNode, CanvasNode[]>): Structure {
	const kids = tree.get(root) ?? [];
	let down = 0;
	let left = 0;
	for (const k of kids) {
		const e = branchEdgeBetween(root, k);
		if (e?.from.side === "bottom" && e.to.side === "top") down++;
		else if (center(k) < center(root)) left++;
	}
	if (kids.length && down * 2 > kids.length) return "down";
	return left ? "both" : "right";
}

/** Root branches clockwise, as MindNode orders them: right side top to bottom, then left side bottom to top. */
function clockwise(root: CanvasNode, kids: CanvasNode[]): CanvasNode[] {
	const right = kids.filter((k) => center(k) >= center(root)).sort((a, b) => a.y - b.y);
	const left = kids.filter((k) => center(k) < center(root)).sort((a, b) => b.y - a.y);
	return [...right, ...left];
}

interface Rect {
	u1: number;
	v1: number;
	u2: number;
	v2: number;
}

/** A laid-out subtree in its own frame: u grows away from the root, v runs along the siblings. */
interface Shape {
	rects: Rect[];
	at: Map<CanvasNode, { u: number; v: number }>;
}

function spanV(rects: Rect[]): number {
	return Math.max(...rects.map((r) => r.v2)) - Math.min(...rects.map((r) => r.v1));
}

// ---------- Plugin ----------

export default class CanvasQuickMindmap extends Plugin {
	settings: Settings = { ...DEFAULT_SETTINGS };
	private restoreMenu: (() => void) | null = null;

	async onload() {
		await this.loadSettings();
		linkArrows = () => this.settings.linkArrows;
		const s = t();

		this.addCommand({ id: "add-child", name: s.addChild, icon: "arrow-right-from-line", checkCallback: (checking) => this.commandFor("child", checking) });
		this.addCommand({ id: "add-sibling", name: s.addSibling, icon: "arrow-down-from-line", checkCallback: (checking) => this.commandFor("sibling", checking) });
		this.addCommand({
			id: "select-parent",
			name: s.selectParent,
			icon: "arrow-left-from-line",
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				const node = canvas && this.singleSelected(canvas);
				if (!node || !parentOf(node)) return false;
				if (!checking) this.selectParent(node);
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
			const roots = node ? [rootOf(node)] : [...canvas.nodes.values()].filter((n) => !isGroup(n) && !parentOf(n) && outgoing(n).length);
			if (!roots.some((r) => outgoing(r).length)) return false;
			if (!checking) {
				for (const r of roots) if (outgoing(r).length) fn(r);
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
				if (!canvas) return false;
				if (!checking) this.tidy(canvas);
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
			this.patchMenuFromOpenCanvas();
			this.addTidyButtons();
			// Registered after load: the vault fires "create" for every existing file while it starts up.
			this.registerEvent(this.app.vault.on("create", (file) => this.onFileCreated(file)));
		});
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.patchMenuFromOpenCanvas();
				this.addTidyButtons();
			}),
		);
		// Every canvas, including those in popout windows, not just the active document.
		this.register(() => {
			for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
				leaf.view.containerEl.querySelectorAll(".cqm-tidy").forEach((el) => el.remove());
			}
		});

		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {
		this.restoreMenu?.();
		for (const [view, handler] of this.findKeys) view.scope?.unregister(handler);
		for (const search of this.searches.values()) search.close(false);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<Settings> | null);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ---------- Entry points ----------

	private activeCanvasView(): CanvasView | null {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		return view && view.getViewType() === "canvas" && (view as CanvasView).canvas ? (view as CanvasView) : null;
	}

	private activeCanvas(): Canvas | null {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		if (!view || view.getViewType() !== "canvas") return null;
		return (view as CanvasView).canvas ?? null;
	}

	private singleSelected(canvas: Canvas): CanvasNode | null {
		if (canvas.readonly || canvas.selection.size !== 1) return null;
		const [node] = canvas.selection;
		if (!node || !("getData" in node) || isGroup(node)) return null; // edges can be selected too
		return node;
	}

	private commandFor(action: Action, checking: boolean): boolean {
		const canvas = this.activeCanvas();
		const node = canvas && this.singleSelected(canvas);
		if (!node) return false;
		if (!checking) this.add(node, action);
		return true;
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
		const back = isShiftTab(evt);
		if (!back && (evt.ctrlKey || evt.metaKey || evt.altKey || evt.shiftKey)) return;
		// Tab adds a child; Shift+Tab goes back to the parent; Enter opens the selected node for editing (siblings: Enter while typing, or the + below).
		const action: Action | "edit" | "parent" | null = back ? "parent" : evt.key === "Tab" ? "child" : evt.key === "Enter" ? "edit" : null;
		if (!action) return;

		const canvas = this.activeCanvas();
		if (!canvas) return;
		const target = evt.target as HTMLElement | null;
		const doc = canvas.wrapperEl.ownerDocument;
		const onCanvas = !target || target === doc.body || canvas.wrapperEl.contains(target);
		if (!onCanvas || target?.closest("input, textarea, [contenteditable='true']")) return;
		if (doc.querySelector(".modal-container, .suggestion-container, .menu")) return;

		const node = this.singleSelected(canvas);
		if (!node || node.isEditing) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (action === "edit") this.edit(node);
		else if (action === "parent") this.selectParent(node);
		else this.add(node, action);
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
			const canvasView = node && this.app.workspace.getLeavesOfType("canvas").map((l) => l.view as CanvasView).find((v) => v.canvas === node.canvas);
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

	private nodeForEditor(view: EditorView): CanvasNode | null {
		const leaves = this.app.workspace.getLeavesOfType("canvas");
		if (!leaves.length) return null; // typing in an ordinary note with no canvas open: nothing to scan
		for (const leaf of leaves) {
			const canvas = (leaf.view as CanvasView).canvas;
			if (!canvas) continue;
			for (const node of canvas.nodes.values()) {
				if (node.isEditing && node.child?.editor?.cm === view) return node;
			}
		}
		return null;
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
		window.setTimeout(() => {
			canvas.selectOnly(parent);
			canvas.panIntoView(parent.getBBox());
			canvas.wrapperEl.focus();
		}, 0);
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

	/**
	 * Size of a text node showing `text`, measured with a hidden copy of the node's own DOM inside the
	 * canvas so the theme's fonts and paddings apply. Null for text this can't measure faithfully.
	 */
	measure(canvas: Canvas, text: string): { width: number; height: number } | null {
		const plain = plainText(text);
		if (plain === null) return null;
		// A hidden canvas (background tab, another workspace, a window being restored) has no layout:
		// every width reads 0 and the node would be shrunk to the 80x60 minimum. Measure nothing then.
		if (!canvas.canvasEl.isShown()) return null;
		const live = this.liveParagraph(canvas);
		if (live) return this.measureBeside(live, plain);
		const host = canvas.canvasEl.createDiv({ cls: "canvas-node cqm-measure" });
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

			p.addClass("cqm-measure-natural");
			const natural = p.offsetWidth + 2; // a little slack so the line never wraps from rounding
			p.removeClass("cqm-measure-natural");
			p.addClass("cqm-measure-word");
			const word = p.offsetWidth + 2;
			p.removeClass("cqm-measure-word");
			const contentWidth = this.contentWidth(natural, word, padX + border);
			p.addClass("cqm-measure-wrap");
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
			if (node.isEditing || node.getData().type !== "text") continue;
			const p = node.nodeEl.querySelector<HTMLElement>(".markdown-preview-sizer > .el-p > p");
			const view = p?.closest<HTMLElement>(".markdown-preview-view");
			if (!p || !view || !p.offsetWidth || !node.nodeEl.offsetWidth) continue;
			if (view.scrollHeight > view.clientHeight + 1) continue; // a scrollbar would count as padding
			return { node, p };
		}
		return null;
	}

	/** measure() using a hidden paragraph placed beside a real one, so it inherits the real styles. */
	private measureBeside(live: { node: CanvasNode; p: HTMLElement }, plain: string): { width: number; height: number } {
		// Everything around the text: node border, content and preview paddings, as rendered right now.
		const chromeX = live.node.nodeEl.offsetWidth - live.p.offsetWidth;
		const probe = live.p.parentElement!.createEl("p", { text: plain || " " });
		probe.setCssStyles({ position: "absolute", left: "0", top: "0", margin: "0", visibility: "hidden", pointerEvents: "none" });
		try {
			probe.setCssStyles({ whiteSpace: "pre", width: "max-content" });
			const natural = probe.offsetWidth + 2; // a little slack so the line never wraps from rounding
			probe.setCssStyles({ whiteSpace: "pre-wrap", overflowWrap: "normal", wordBreak: "normal", width: "min-content" });
			const word = probe.offsetWidth + 2;
			const contentWidth = this.contentWidth(natural, word, chromeX);
			probe.setCssStyles({ overflowWrap: "break-word", width: `${contentWidth}px` });
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

	add(from: CanvasNode, action: Action) {
		const canvas = from.canvas;
		const parent = action === "child" ? from : parentOf(from);
		if (from.isEditing) from.blur();
		if (this.settings.autoSize) this.fit(from);

		const size = (this.settings.autoSize && this.measure(canvas, "")) || { ...canvas.config.defaultTextNodeDimensions };
		// Which way the new node goes from its parent: a sibling follows `from`, a child its parent's branch.
		const dir: Dir = !parent ? "right" : action === "child" ? this.growDir(from) : this.dirFrom(parent, from);
		// Start on the right side of the parent, so the arrow never reads as one pointing back.
		const { hGap, vGap } = this.settings;
		let pos: { x: number; y: number };
		if (action === "child") {
			pos = dir === "down" ? { x: from.x, y: from.y + from.height + hGap } : dir === "left" ? { x: from.x - hGap - size.width, y: from.y } : { x: from.x + from.width + hGap, y: from.y };
		} else {
			pos = dir === "down" ? { x: from.x + from.width + vGap, y: from.y } : { x: from.x, y: from.y + from.height + vGap };
		}
		const node = canvas.createTextNode({ pos, size, text: "", focus: false, save: false });

		if (parent) {
			const [fromSide, toSide] = SIDE_PAIR[dir];
			canvas.importData({
				nodes: [],
				edges: [{ id: randomId(), fromNode: parent.id, fromSide, toNode: node.id, toSide }],
			});
			forgetBranches(canvas);
		}

		if (parent && this.settings.autoLayout) {
			const root = rootOf(parent);
			this.layout(root, { node, after: action === "sibling" ? from : null });
			// A one-sided map that just reached the threshold spreads over both sides, once.
			const n = this.settings.balanceFrom;
			if (parent === root && n > 0) {
				const tree = buildTree(root);
				if (structureOf(root, tree) === "right" && (tree.get(root) ?? []).length === n) this.balance(root);
			}
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
		let x: number;
		let y: number;
		if (dir === "down") {
			// Downward map: children in a row under the parent, siblings to the right; step right past anything in the way.
			x = action === "child" ? from.x : from.x + from.width + vGap;
			y = action === "child" ? from.y + from.height + hGap : from.y;
			for (let i = 0; i < 200; i++) {
				const hits = node.canvas.getIntersectingNodes(bboxOf({ x, y, width: node.width, height: node.height })).filter((n) => n !== node && !isGroup(n));
				if (!hits.length) break;
				x = Math.max(...hits.map((n) => n.x + n.width)) + vGap;
			}
			node.moveAndResize({ x, y, width: node.width, height: node.height });
			return;
		}
		if (action === "child") {
			const tree = buildTree(from);
			const siblings = (tree.get(from) ?? []).filter((c) => c !== node);
			x = dir === "left" ? from.x - hGap - node.width : from.x + from.width + hGap;
			if (siblings.length) {
				const last = siblings[siblings.length - 1];
				y = subtreeBottom(last, tree) + vGap;
			} else {
				y = from.y + (from.height - node.height) / 2;
			}
		} else {
			const tree = buildTree(from);
			x = from.x;
			y = subtreeBottom(from, tree) + vGap;
		}
		for (let i = 0; i < 200; i++) {
			const box = bboxOf({ x, y, width: node.width, height: node.height });
			const hits = node.canvas.getIntersectingNodes(box).filter((n) => n !== node && !isGroup(n));
			if (!hits.length) break;
			y = Math.max(...hits.map((n) => n.y + n.height)) + vGap;
		}
		node.moveAndResize({ x, y, width: node.width, height: node.height });
	}

	/**
	 * Lay out a whole map around its root, which never moves. The structure is read from the map unless
	 * `groups` says explicitly which root branches go which way (balancing, switching structure).
	 */
	layout(
		root: CanvasNode,
		insert?: { node: CanvasNode; after: CanvasNode | null },
		groups?: { dir: Dir; kids: CanvasNode[] }[],
	) {
		const tree = buildTree(root);
		const structure = groups ? (groups.some((g) => g.dir === "down") ? "down" : "both") : structureOf(root, tree);
		// Siblings in reading order: left to right in a downward map, top to bottom otherwise.
		if (structure === "down") for (const kids of tree.values()) kids.sort((a, b) => a.x - b.x || a.y - b.y);

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

		const dirs = new Map<CanvasNode, Dir>();
		for (const g of groups) {
			if (!g.kids.length) continue;
			const shape = this.shape(root, tree, g.kids, g.dir === "down");
			for (const [n, p] of shape.at) {
				if (n === root) continue;
				let x: number;
				let y: number;
				if (g.dir === "down") {
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
		this.straightenEdges(root.canvas, tree, dirs);
		if (this.settings.linkArrows && this.settings.routeLinks) this.routeLinks(root.canvas, new Set(tree.keys()));
	}

	/**
	 * Place `kids` (and everything below them) beside `node`, in a frame where u grows away from the root and
	 * v runs along the siblings. Each sibling goes as close to the previous ones as its own outline allows
	 * (compact) or below their whole band (not compact); the parent is centred on its children.
	 */
	private shape(node: CanvasNode, tree: Map<CanvasNode, CanvasNode[]>, kids: CanvasNode[], down: boolean): Shape {
		const { hGap, vGap } = this.settings;
		const sibGap = down ? Math.max(20, vGap * 2) : vGap;
		const size = (n: CanvasNode) => (down ? { su: n.height, sv: n.width, pre: 0 } : { su: n.width, sv: n.height, pre: labelSpace(n) });
		const own = size(node);
		const rects: Rect[] = [{ u1: 0, v1: -own.pre, u2: own.su, v2: own.sv }];
		const at = new Map<CanvasNode, { u: number; v: number }>([[node, { u: 0, v: 0 }]]);
		if (!kids.length) return { rects, at };

		const childRects: Rect[] = [];
		const childAt = new Map<CanvasNode, { u: number; v: number }>();
		let prevEnd = -Infinity;
		let first = 0;
		let last = 0;
		kids.forEach((k, i) => {
			const sub = this.shape(k, tree, tree.get(k) ?? [], down);
			const ks = size(k);
			const du = own.su + hGap + (down ? labelSpace(k) : 0);
			const outline = this.settings.compact
				? sub.rects
				: [{ u1: Math.min(...sub.rects.map((r) => r.u1)), v1: Math.min(...sub.rects.map((r) => r.v1)), u2: Math.max(...sub.rects.map((r) => r.u2)), v2: Math.max(...sub.rects.map((r) => r.v2)) }];
			// Keep the order: this node starts below the previous sibling node.
			let dv = i === 0 ? 0 : prevEnd + sibGap + ks.pre;
			for (const p of childRects) {
				for (const r of outline) {
					if (r.u1 + du < p.u2 && p.u1 < r.u2 + du) dv = Math.max(dv, p.v2 + sibGap - r.v1);
				}
			}
			for (const r of outline) childRects.push({ u1: r.u1 + du, v1: r.v1 + dv, u2: r.u2 + du, v2: r.v2 + dv });
			for (const [n, p] of sub.at) childAt.set(n, { u: p.u + du, v: p.v + dv });
			if (i === 0) first = dv;
			prevEnd = dv + ks.sv;
			last = prevEnd;
		});
		// Centre the parent on its children nodes.
		const off = own.sv / 2 - (first + last) / 2;
		for (const r of childRects) rects.push({ u1: r.u1, v1: r.v1 + off, u2: r.u2, v2: r.v2 + off });
		for (const [n, p] of childAt) at.set(n, { u: p.u, v: p.v + off });
		return { rects, at };
	}

	/** Height (or width, downward) a root branch takes, with everything below it. */
	private branchSpan(k: CanvasNode, tree: Map<CanvasNode, CanvasNode[]>, down: boolean): number {
		return spanV(this.shape(k, tree, tree.get(k) ?? [], down).rects);
	}

	/** Spread the root branches over both sides, keeping their clockwise order and evening out the two heights. */
	balance(root: CanvasNode) {
		const tree = buildTree(root);
		const order = clockwise(root, tree.get(root) ?? []);
		if (order.length < 2) return;
		const spans = order.map((k) => this.branchSpan(k, tree, false));
		const total = spans.reduce((a, b) => a + b, 0);
		let best = 1;
		let bestDiff = Infinity;
		let acc = 0;
		for (let k = 1; k < order.length; k++) {
			acc += spans[k - 1];
			const diff = Math.abs(acc - (total - acc));
			if (diff < bestDiff) {
				bestDiff = diff;
				best = k;
			}
		}
		this.layout(root, undefined, [
			{ dir: "right", kids: order.slice(0, best) },
			{ dir: "left", kids: order.slice(best).reverse() },
		]);
	}

	/** Switch a map to one structure, keeping the branches' clockwise order. */
	restructure(root: CanvasNode, to: "right" | "down") {
		const tree = buildTree(root);
		const kids = tree.get(root) ?? [];
		const order = structureOf(root, tree) === "down" ? [...kids].sort((a, b) => a.x - b.x) : clockwise(root, kids);
		this.layout(root, undefined, [{ dir: to, kids: order }]);
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
			const span = (side: CanvasNode[]) => side.reduce((a, k) => a + this.branchSpan(k, tree, false) + this.settings.vGap, 0);
			const right = kids.filter((k) => center(k) >= center(root));
			const left = kids.filter((k) => center(k) < center(root));
			return span(left) < span(right) ? "left" : "right";
		}
		return this.sideOf(node, root);
	}

	/** Direction of an existing child from its parent. */
	private dirFrom(parent: CanvasNode, child: CanvasNode): Dir {
		const e = branchEdgeBetween(parent, child);
		if (e?.from.side === "bottom" && e.to.side === "top") return "down";
		return center(child) < center(parent) ? "left" : "right";
	}

	/** Left or right of the root, by the root branch a node belongs to. */
	private sideOf(node: CanvasNode, root: CanvasNode): Dir {
		let branch = node;
		for (let i = 0; i < 1000; i++) {
			const p = parentOf(branch);
			if (!p || p === root) break;
			branch = p;
		}
		return center(branch) < center(root) ? "left" : "right";
	}

	/**
	 * Reattach links (arrows that aren't branches) to the pair of sides whose curve crosses the fewest
	 * other nodes, then is shortest. The side pairs branches use stay reserved for them, so a link never turns into one.
	 * With `only`, just the links touching those nodes.
	 */
	routeLinks(canvas: Canvas, only?: Set<CanvasNode>) {
		const branches = branchEdges(canvas);
		const branchSet = new Set(branches.values());
		const others = [...canvas.nodes.values()].filter((n) => !isGroup(n));
		const changed: unknown[] = [];
		for (const e of canvas.edges.values()) {
			const a = e.from.node;
			const b = e.to.node;
			if (branchSet.has(e) || !a || !b || a === b || isGroup(a) || isGroup(b)) continue;
			if (only && !only.has(a) && !only.has(b)) continue;
			const near = others.filter((n) => n !== a && n !== b && overlaps(bboxOf(n), linkReach(a, b), 0));
			const score = (fs: Side, ts: Side) => {
				const pts = edgeCurve(a, fs, b, ts);
				let hits = 0;
				for (const n of near) if (pts.some((p) => inBox(p, bboxOf(n), 6))) hits++;
				// Curling back through its own ends is as bad as crossing a node.
				const inner = pts.slice(3, -3);
				if (inner.some((p) => inBox(p, bboxOf(a), -2))) hits++;
				if (inner.some((p) => inBox(p, bboxOf(b), -2))) hits++;
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
		const { vGap } = this.settings;
		const gap = vGap * 3;
		const roots = [...canvas.nodes.values()].filter((n) => !isGroup(n) && !parentOf(n) && outgoing(n).length);
		roots.sort((a, b) => a.y - b.y || a.x - b.x);

		const trees: CanvasNode[][] = [];
		for (const root of roots) {
			const tree = buildTree(root);
			if (this.settings.autoSize) for (const n of tree.keys()) this.fit(n);
			this.layout(root);
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
		if (this.settings.linkArrows && this.settings.routeLinks) this.routeLinks(canvas);

		// Loose nodes (no edges at all) that ended up under a tree go below everything.
		const inTree = new Set(trees.flat());
		let bottom = placed.length ? Math.max(...placed.map((b) => b.maxY)) : 0;
		for (const n of canvas.nodes.values()) {
			if (inTree.has(n) || isGroup(n) || canvas.getEdgesForNode(n).length) continue;
			const box = bboxOf(n);
			if (!placed.some((p) => overlaps(p, box, 0))) continue;
			const left = Math.min(...placed.filter((p) => overlaps(p, box, 0)).map((p) => p.minX));
			n.moveAndResize({ x: left, y: bottom + gap, width: n.width, height: n.height });
			bottom = n.y + n.height;
		}
		canvas.requestSave();
	}

	/** Branch arrows follow their direction: right to left, left to right on the left half, bottom to top downward. */
	private straightenEdges(canvas: Canvas, tree: Map<CanvasNode, CanvasNode[]>, dirs: Map<CanvasNode, Dir>) {
		const changed: unknown[] = [];
		for (const [parent, kids] of tree) {
			for (const e of canvas.getEdgesForNode(parent)) {
				if (e.from.node !== parent || !kids.includes(e.to.node)) continue;
				if (linkArrows() && branchEdges(canvas).get(e.to.node) !== e) continue; // links keep their sides
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

	// ---------- Tidy button in the canvas controls (right-hand toolbar) ----------

	private findKeys = new Map<CanvasView, KeymapEventHandler>();

	private addTidyButtons() {
		// Forget canvases that have been closed, so their views (and everything they hold) can be freed.
		const open = new Set(this.app.workspace.getLeavesOfType("canvas").map((l) => l.view as CanvasView));
		for (const [view, handler] of this.findKeys) {
			if (open.has(view)) continue;
			view.scope?.unregister(handler);
			this.findKeys.delete(view);
		}
		for (const [view, search] of this.searches) if (!open.has(view)) search.close(false);
		for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
			const view = leaf.view as CanvasView;
			// Mod+F belongs to "Search current file", whose hotkey fires before any plugin listener.
			// The canvas view's own scope is consulted first, so claim the key there.
			if (view.scope && !this.findKeys.has(view)) {
				this.findKeys.set(
					view,
					view.scope.register(["Mod"], "f", () => {
						this.openSearch(view);
						return false;
					}),
				);
			}
			const controls = view.containerEl.querySelector(".canvas-controls");
			if (!view.canvas || !controls || controls.querySelector(".cqm-tidy")) continue;
			const group = createDiv({ cls: "canvas-control-group mod-raised cqm-tidy" });
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
			search = new CanvasSearch(this.app, view, () => this.searches.delete(view));
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
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		if (!view || view.getViewType() !== "canvas") return;
		const { canvas, file: canvasFile } = view as CanvasView;
		if (!canvas || !canvasFile) return;
		void this.renameIfUsedBy(file, canvas, canvasFile);
	}

	private async renameIfUsedBy(file: TFile, canvas: Canvas, canvasFile: TFile) {
		const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
		const originalPath = file.path;
		const oldName = file.name;
		const usedByCanvas = () =>
			[...canvas.nodes.values()].some((n) => n.file === file || (typeof n.text === "string" && mentions(n.text, oldName)));

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
		for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
			const canvas = (leaf.view as CanvasView).canvas;
			if (canvas?.menu) {
				this.patchMenu(canvas.menu);
				return;
			}
		}
	}

	private patchMenu(menu: CanvasMenu) {
		const proto = Object.getPrototypeOf(menu) as CanvasMenu;
		const original = proto.render;
		const decorate = (m: CanvasMenu) => this.decorateMenu(m);
		const patched = function (this: CanvasMenu, ...args: unknown[]): unknown {
			const result: unknown = original.call(this, ...args);
			try {
				decorate(this);
			} catch (e) {
				console.error("[canvas-arbor]", e);
			}
			return result;
		};
		proto.render = patched;
		this.restoreMenu = () => {
			if (proto.render === patched) proto.render = original;
			for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
				(leaf.view as CanvasView).canvas?.wrapperEl.querySelectorAll(".cqm-node-button").forEach((el) => el.remove());
			}
		};
		menu.render(true);
	}

	/** Runs whenever the canvas redraws its selection menu, i.e. whenever the selection changes. */
	private decorateMenu(menu: CanvasMenu) {
		const canvas = menu.canvas;
		const node = canvas.isDragging ? null : this.singleSelected(canvas);
		canvas.wrapperEl.querySelectorAll(".cqm-node-button").forEach((el) => {
			if (!node || el.parentElement !== node.nodeEl) el.remove();
		});
		if (!node || node.nodeEl.querySelector(".cqm-node-button")) return;
		const s = t();
		const make = (cls: string, icon: string, tip: string, placement: "right" | "bottom" | "top", run: () => void) => {
			const btn = node.nodeEl.createDiv({ cls: `cqm-node-button ${cls}`, attr: { role: "button" } });
			setIcon(btn, icon);
			setTooltip(btn, tip, { placement });
			// Keep the canvas from treating these as a drag, a selection change or a double-click on the node.
			for (const type of ["pointerdown", "mousedown", "dblclick"]) btn.addEventListener(type, (evt) => evt.stopPropagation());
			btn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				run();
			});
		};
		make("cqm-add cqm-add-child", "plus", s.childTip, "right", () => this.add(node, "child"));
		make("cqm-add cqm-add-sibling", "plus", s.siblingTip, "bottom", () => this.add(node, "sibling"));
		const file = node.file;
		if (file && IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) {
			make("cqm-copy", "copy", s.copyTip, "top", () => void this.copyImage(file));
		}
	}
}

/** Apple keyboards (Mac, and iPad / iPhone with a hardware keyboard) use Cmd where others use Ctrl. */
function usesCmd(): boolean {
	return Platform.isMacOS || Platform.isIosApp;
}

function isShiftTab(evt: KeyboardEvent): boolean {
	return evt.key === "Tab" && evt.shiftKey && !evt.ctrlKey && !evt.metaKey && !evt.altKey;
}

function isFindKey(evt: KeyboardEvent): boolean {
	const mod = usesCmd() ? evt.metaKey && !evt.ctrlKey : evt.ctrlKey && !evt.metaKey;
	return mod && !evt.shiftKey && !evt.altKey && evt.key.toLowerCase() === "f";
}

/**
 * Find bar for one canvas view, built from Obsidian's own find-bar classes so it looks native.
 * Matching nodes are highlighted, the rest dimmed; Enter / Shift+Enter walk through them.
 */
class CanvasSearch {
	private containerEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private countEl: HTMLElement | null = null;
	private hits: CanvasNode[] = [];
	private index = -1;
	private noteText = new Map<string, string>();
	private timer = 0;

	constructor(private app: App, private view: CanvasView, private onClosed: () => void) {}

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
		const container = (this.containerEl = this.view.contentEl.createDiv({ cls: "document-search-container cqm-search", prepend: true }));
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
			this.timer = window.setTimeout(() => this.run(), 120);
		});
		input.addEventListener("keydown", (evt) => {
			if (evt.isComposing || evt.key === "Process") return; // an input method is still choosing characters
			if (evt.key === "Enter") {
				evt.preventDefault();
				evt.stopPropagation();
				if (this.hits.length && this.index < 0) this.run(); // typed and hit Enter before the debounce
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
		this.canvas.wrapperEl.addClass("cqm-searching");
		this.hits.forEach((n) => n.nodeEl.addClass("cqm-search-hit"));
		if (!this.hits.length) {
			this.setCount(t().searchNone);
			return;
		}
		if (jump) this.step(1);
		else this.setCount(`0 / ${this.hits.length}`);
	}

	private step(delta: number) {
		if (!this.hits.length) return;
		this.hits[this.index]?.nodeEl.removeClass("cqm-search-current");
		this.index = (this.index + delta + this.hits.length) % this.hits.length;
		const node = this.hits[this.index];
		node.nodeEl.addClass("cqm-search-current");
		this.setCount(`${this.index + 1} / ${this.hits.length}`);
		this.reveal(node);
	}

	/** Centre the node; zoom in first if the canvas is too far out to read it. */
	private reveal(node: CanvasNode) {
		const c = this.canvas;
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
		this.canvas.wrapperEl.removeClass("cqm-searching");
		this.canvas.wrapperEl.querySelectorAll(".cqm-search-hit, .cqm-search-current").forEach((el) => el.removeClass("cqm-search-hit", "cqm-search-current"));
	}

	/** `keepCurrent`: leave the result you were on selected, so Enter edits it straight away. */
	close(keepCurrent: boolean) {
		window.clearTimeout(this.timer);
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

type ToggleKey = "autoLayout" | "enterInEdit" | "tabAddsChild" | "mobileKeys" | "linkArrows" | "routeLinks" | "compact" | "autoSize" | "renamePasted";
type SliderKey = "hGap" | "vGap" | "maxWidth" | "balanceFrom";
type SettingSpec =
	| { kind: "toggle"; key: ToggleKey; name: string; desc: string }
	| { kind: "slider"; key: SliderKey; name: string; desc: string; min: number; max: number; step: number };

function settingSpecs(): SettingSpec[] {
	const s = t();
	return [
		{ kind: "toggle", key: "autoLayout", name: s.autoLayout, desc: s.autoLayoutDesc },
		{ kind: "toggle", key: "enterInEdit", name: s.enterInEdit, desc: s.enterInEditDesc },
		{ kind: "toggle", key: "tabAddsChild", name: s.tabAddsChild, desc: s.tabAddsChildDesc },
		{ kind: "toggle", key: "mobileKeys", name: s.mobileKeys, desc: s.mobileKeysDesc },
		{ kind: "slider", key: "hGap", name: s.hGap, desc: s.hGapDesc, min: 80, max: 400, step: 10 },
		{ kind: "slider", key: "vGap", name: s.vGap, desc: s.vGapDesc, min: 0, max: 200, step: 10 },
		{ kind: "toggle", key: "compact", name: s.compact, desc: s.compactDesc },
		{ kind: "slider", key: "balanceFrom", name: s.balanceFrom, desc: s.balanceFromDesc, min: 0, max: 12, step: 1 },
		{ kind: "toggle", key: "linkArrows", name: s.linkArrows, desc: s.linkArrowsDesc },
		{ kind: "toggle", key: "routeLinks", name: s.routeLinks, desc: s.routeLinksDesc },
		{ kind: "toggle", key: "autoSize", name: s.autoSize, desc: s.autoSizeDesc },
		{ kind: "slider", key: "maxWidth", name: s.maxWidth, desc: s.maxWidthDesc, min: 160, max: 800, step: 20 },
		{ kind: "toggle", key: "renamePasted", name: s.renamePasted, desc: s.renamePastedDesc },
	];
}

class SettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CanvasQuickMindmap) {
		super(app, plugin);
	}

	/** 1.13+: declarative settings, searchable from the settings window. Values go through plugin.settings. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return settingSpecs().map((spec) =>
			spec.kind === "toggle"
				? { name: spec.name, desc: spec.desc, control: { type: "toggle", key: spec.key, defaultValue: DEFAULT_SETTINGS[spec.key] } }
				: {
						name: spec.name,
						desc: spec.desc,
						control: { type: "slider", key: spec.key, min: spec.min, max: spec.max, step: spec.step, defaultValue: DEFAULT_SETTINGS[spec.key] },
					},
		);
	}

	/** Before 1.13 (minAppVersion is 1.8.7). */
	display() {
		const { containerEl } = this;
		containerEl.empty();
		for (const spec of settingSpecs()) {
			const row = new Setting(containerEl).setName(spec.name).setDesc(spec.desc);
			if (spec.kind === "toggle") {
				const key = spec.key;
				row.addToggle((tg) =>
					tg.setValue(this.plugin.settings[key]).onChange(async (v) => {
						this.plugin.settings[key] = v;
						await this.plugin.saveSettings();
					}),
				);
			} else {
				const key = spec.key;
				row.addSlider((sl) =>
					sl
						.setLimits(spec.min, spec.max, spec.step)
						.setValue(this.plugin.settings[key])
						.onChange(async (v) => {
							this.plugin.settings[key] = v;
							await this.plugin.saveSettings();
						}),
				);
			}
		}
	}
}
