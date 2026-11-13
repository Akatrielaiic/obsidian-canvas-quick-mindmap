// Canvas internals (not part of the public API; shapes observed in Obsidian 1.14).
import type { EditorView } from "@codemirror/view";
import type { ItemView, TFile } from "obsidian";

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export interface CanvasNodeData {
	id?: string;
	type: string;
	text?: string;
	file?: string;
	label?: string;
	url?: string;
	color?: string;
}

export interface CanvasNode {
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
	color?: string;
	child?: { editor?: { cm?: EditorView }; editMode?: { focus(): void } };
	setText?(text: string): void;
	setColor?(color: string): void;
	setData?(data: CanvasNodeData): void;
	subpath?: string;
	setFile?(file: TFile, subpath: string, force: boolean): void;
	unloadChild?(): void;
	getData(): CanvasNodeData;
	moveAndResize(rect: { x: number; y: number; width: number; height: number }): void;
	attach(): void;
	render(): void;
	startEditing(): void;
	blur(): void;
	getBBox(): BBox;
}

export interface CanvasEdge {
	id: string;
	from: { node: CanvasNode; side: string };
	to: { node: CanvasNode; side: string };
	lineGroupEl?: Element;
	lineEndGroupEl?: Element;
	labelElement?: { wrapperEl?: HTMLElement };
	getData(): { id: string; fromSide?: string; toSide?: string; color?: string };
}

export interface CanvasMenu {
	canvas: Canvas;
	menuEl: HTMLElement;
	render: (this: CanvasMenu, ...args: unknown[]) => unknown;
}

export interface Canvas {
	nodes: Map<string, CanvasNode>;
	edges: Map<string, CanvasEdge>;
	selection: Set<CanvasNode>;
	readonly: boolean;
	isDragging: boolean;
	wrapperEl: HTMLElement;
	canvasEl: HTMLElement;
	menu: CanvasMenu;
	view?: CanvasView;
	x?: number;
	y?: number;
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
	deselectAll?(): void;
	requestSave(): void;
	markDirty(node: CanvasNode): void;
	requestFrame(): void;
	panIntoView(bbox: BBox): void;
	panTo(x: number, y: number): void;
	zoomToBbox(bbox: BBox): void;
	posCenter?(): { x: number; y: number };
	zoom: number;
	zoomBreakpoint: number;
}

export interface CanvasView extends ItemView {
	canvas: Canvas;
	file: TFile | null;
}
