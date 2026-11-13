import type { BBox, CanvasNode } from "./canvas";

export interface Box { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export function bboxOf(n: Box): BBox {
	return { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height };
}

/** File nodes (images, notes) show their file name above the box. */
export function labelSpace(n: { file?: unknown }): number {
	return n.file ? 30 : 0;
}

export function unionBox(nodes: (Box & { file?: unknown })[]): BBox {
	const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const n of nodes) {
		box.minX = Math.min(box.minX, n.x);
		box.minY = Math.min(box.minY, n.y - labelSpace(n));
		box.maxX = Math.max(box.maxX, n.x + n.width);
		box.maxY = Math.max(box.maxY, n.y + n.height);
	}
	return box;
}

export function overlaps(a: BBox, b: BBox, margin: number): boolean {
	return a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minY < b.maxY + margin && b.minY < a.maxY + margin;
}

export function moveBy(n: CanvasNode, dx: number, dy: number) {
	n.moveAndResize({ x: n.x + dx, y: n.y + dy, width: n.width, height: n.height });
}

export function center(n: Box): number {
	return n.x + n.width / 2;
}

export function middle(n: Box): number {
	return n.y + n.height / 2;
}

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];
const SIDE_DIR: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

function sidePoint(n: Box, side: Side): Point {
	return { x: center(n) + (SIDE_DIR[side].x * n.width) / 2, y: middle(n) + (SIDE_DIR[side].y * n.height) / 2 };
}

/** Points along the curve Obsidian draws for an edge: a cubic Bézier leaving each side along its normal. */
export function edgeCurve(a: Box, fs: Side, b: Box, ts: Side, steps = 24): Point[] {
	const p0 = sidePoint(a, fs);
	const p3 = sidePoint(b, ts);
	const pull = Math.min(150, Math.max(40, Math.hypot(p3.x - p0.x, p3.y - p0.y) / 2));
	const p1 = { x: p0.x + SIDE_DIR[fs].x * pull, y: p0.y + SIDE_DIR[fs].y * pull };
	const p2 = { x: p3.x + SIDE_DIR[ts].x * pull, y: p3.y + SIDE_DIR[ts].y * pull };
	const pts: Point[] = [];
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
export function linkReach(a: Box, b: Box): BBox {
	return {
		minX: Math.min(a.x, b.x) - 160,
		minY: Math.min(a.y, b.y) - 160,
		maxX: Math.max(a.x + a.width, b.x + b.width) + 160,
		maxY: Math.max(a.y + a.height, b.y + b.height) + 160,
	};
}

export function inBox(p: Point, box: BBox, pad: number): boolean {
	return p.x > box.minX - pad && p.x < box.maxX + pad && p.y > box.minY - pad && p.y < box.maxY + pad;
}
