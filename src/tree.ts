// Reading mind map trees out of a canvas: which arrows are branches, who is whose parent.
import type { Canvas, CanvasEdge, CanvasNode } from "./canvas";
import { center, middle } from "./geometry";

/** Set from the plugin. */
export const hooks = {
	/** Whether extra arrows are links (see branchEdges) or every arrow is a branch. */
	linkArrows: (): boolean => true,
	/** A node inside a collapsed branch. */
	hidden: (_node: CanvasNode): boolean => false,
	/** A node whose branch is collapsed. */
	collapsed: (_node: CanvasNode): boolean => false,
};

export function isGroup(node: CanvasNode): boolean {
	return node.getData().type === "group";
}

/** The arrow that makes a node's branch, per node. Computed once per task (and after our own edge edits). */
const branchCache = new WeakMap<Canvas, Map<CanvasNode, CanvasEdge>>();

export function forgetBranches(canvas: Canvas) {
	branchCache.delete(canvas);
}

/** The side pairs branches use: right to left, left to right (left half of a map), bottom to top (downward map). */
export function isBranchLook(fromSide: string, toSide: string): boolean {
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
export function branchEdges(canvas: Canvas): Map<CanvasNode, CanvasEdge> {
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

export function parentOf(node: CanvasNode): CanvasNode | null {
	if (hooks.linkArrows()) return branchEdges(node.canvas).get(node)?.from.node ?? null;
	const edge = node.canvas.getEdgesForNode(node).find((e) => e.to.node === node && e.from.node !== node && !isGroup(e.from.node));
	return edge ? edge.from.node : null;
}

/**
 * A node's children. Collapsed branches end at their node and hidden nodes are nobody's children,
 * unless `all` asks for everything that is really there.
 */
export function outgoing(node: CanvasNode, all = false): CanvasNode[] {
	const out: CanvasNode[] = [];
	if (!all && hooks.collapsed(node)) return out;
	const branches = hooks.linkArrows() ? branchEdges(node.canvas) : null;
	for (const e of node.canvas.getEdgesForNode(node)) {
		const target = e.to.node;
		if (e.from.node !== node || target === node || isGroup(target) || out.includes(target)) continue;
		if (branches && branches.get(target) !== e) continue; // a link, not one of this node's branches
		if (!all && hooks.hidden(target)) continue;
		out.push(target);
	}
	return out;
}

export function rootOf(node: CanvasNode): CanvasNode {
	const seen = new Set<CanvasNode>([node]);
	let cur = node;
	for (;;) {
		const p = parentOf(cur);
		if (!p || seen.has(p)) return cur;
		seen.add(p);
		cur = p;
	}
}

export type Tree = Map<CanvasNode, CanvasNode[]>;

/** Children of every node in the tree under `root`, each node claimed once (breadth first), ordered top to bottom. */
export function buildTree(root: CanvasNode, all = false): Tree {
	const tree: Tree = new Map();
	const claimed = new Set<CanvasNode>([root]);
	const queue = [root];
	for (let i = 0; i < queue.length; i++) {
		const n = queue[i];
		const kids = outgoing(n, all).filter((c) => !claimed.has(c));
		kids.sort((a, b) => a.y - b.y || a.x - b.x);
		for (const c of kids) {
			claimed.add(c);
			queue.push(c);
		}
		tree.set(n, kids);
	}
	return tree;
}

export function subtreeBottom(node: CanvasNode, tree: Tree): number {
	let bottom = node.y + node.height;
	for (const c of tree.get(node) ?? []) bottom = Math.max(bottom, subtreeBottom(c, tree));
	return bottom;
}

// ---------- Map structures ----------

/** Which way a node's children grow. */
export type Dir = "right" | "left" | "down";
/** How a whole map is laid out: all to the right, on both sides of the root, or downward like an org chart. */
export type Structure = "right" | "both" | "down";

/** Sides a branch arrow uses, by the direction its child grows. */
export const SIDE_PAIR: Record<Dir, [string, string]> = { right: ["right", "left"], left: ["left", "right"], down: ["bottom", "top"] };

/** The branch arrow from parent to child, if there is one. */
export function branchEdgeBetween(parent: CanvasNode, child: CanvasNode): CanvasEdge | undefined {
	if (hooks.linkArrows()) {
		const e = branchEdges(child.canvas).get(child);
		return e && e.from.node === parent ? e : undefined;
	}
	return parent.canvas.getEdgesForNode(parent).find((e) => e.from.node === parent && e.to.node === child);
}

/** Read from the map itself, nothing is stored: arrows leaving the root from below mean downward, branches left of the root mean both sides. */
export function structureOf(root: CanvasNode, tree: Tree): Structure {
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
export function clockwise(root: CanvasNode, kids: CanvasNode[]): CanvasNode[] {
	const right = kids.filter((k) => center(k) >= center(root)).sort((a, b) => a.y - b.y);
	const left = kids.filter((k) => center(k) < center(root)).sort((a, b) => b.y - a.y);
	return [...right, ...left];
}

/** Direction of an existing child from its parent. */
export function dirFrom(parent: CanvasNode, child: CanvasNode): Dir {
	const e = branchEdgeBetween(parent, child);
	if (e?.from.side === "bottom" && e.to.side === "top") return "down";
	return center(child) < center(parent) ? "left" : "right";
}

/** Left or right of the root, by the root branch a node belongs to. */
export function sideOf(node: CanvasNode, root: CanvasNode): Dir {
	let branch = node;
	for (let i = 0; i < 1000; i++) {
		const p = parentOf(branch);
		if (!p || p === root) break;
		branch = p;
	}
	return center(branch) < center(root) ? "left" : "right";
}

/**
 * Siblings in reading order (left to right in a downward map, top to bottom otherwise) and the
 * map's structure. Sorts the tree in place.
 */
export function readingOrder(root: CanvasNode, tree: Tree): Structure {
	const structure = structureOf(root, tree);
	if (structure === "down") for (const kids of tree.values()) kids.sort((a, b) => a.x - b.x || a.y - b.y);
	return structure;
}

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

const AWAY: Record<Dir, ArrowKey> = { right: "ArrowRight", left: "ArrowLeft", down: "ArrowDown" };
const BACK: Record<Dir, ArrowKey> = { right: "ArrowLeft", left: "ArrowRight", down: "ArrowUp" };

/** The child whose middle is nearest to the node's, along the siblings' axis. */
function nearest(node: CanvasNode, kids: CanvasNode[], down: boolean): CanvasNode | null {
	const pos = down ? center : middle;
	let best: CanvasNode | null = null;
	for (const k of kids) if (!best || Math.abs(pos(k) - pos(node)) < Math.abs(pos(best) - pos(node))) best = k;
	return best;
}

/** Nodes at the same depth and on the same side of the map as `node`, in reading order. */
export function sameLevel(node: CanvasNode, root: CanvasNode, tree: Tree, structure: Structure): CanvasNode[] {
	const side = structure === "both" ? sideOf(node, root) : null;
	const path = new Set<CanvasNode>();
	let depth = 0;
	for (let cur: CanvasNode | null = node; cur && cur !== root && !path.has(cur); cur = parentOf(cur)) {
		path.add(cur);
		depth++;
	}
	const level: CanvasNode[] = [];
	const walk = (n: CanvasNode, d: number) => {
		if (d === depth) {
			level.push(n);
			return;
		}
		for (const k of tree.get(n) ?? []) walk(k, d + 1);
	};
	for (const k of tree.get(root) ?? []) {
		if (side && (center(k) < center(root) ? "left" : "right") !== side) continue;
		walk(k, 1);
	}
	return level;
}

/**
 * Where an arrow key leads from a node: away from the root to the nearest child, back to the parent,
 * across to the previous or next node on the same level (a sibling, or the neighbouring branch's node).
 */
export function neighbour(node: CanvasNode, key: ArrowKey): CanvasNode | null {
	const root = rootOf(node);
	const tree = buildTree(root);
	const structure = readingOrder(root, tree);
	const kids = tree.get(node) ?? [];
	if (node === root) {
		if (structure === "down") return key === "ArrowDown" ? nearest(node, kids, true) : null;
		if (key === "ArrowRight") return nearest(node, kids.filter((k) => center(k) >= center(root)), false);
		if (key === "ArrowLeft") return nearest(node, kids.filter((k) => center(k) < center(root)), false);
		return null;
	}
	const dir: Dir = structure === "down" ? "down" : sideOf(node, root);
	if (key === AWAY[dir]) return nearest(node, kids, dir === "down");
	if (key === BACK[dir]) return parentOf(node);
	const level = sameLevel(node, root, tree, structure);
	const i = level.indexOf(node);
	if (i < 0) return null;
	return level[i + (key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1)] ?? null;
}

/**
 * The same walk with the branch arrows as stops on the way: from a node toward its parent or child
 * the arrow between them comes first.
 */
export function neighbourVia(node: CanvasNode, key: ArrowKey): CanvasNode | CanvasEdge | null {
	const target = neighbour(node, key);
	if (!target) return null;
	const parent = parentOf(node);
	if (target === parent) return branchEdgeBetween(parent, node) ?? target;
	if (parentOf(target) === node) return branchEdgeBetween(node, target) ?? target;
	return target;
}

/** From a branch arrow: on to its child, back to its parent, across to the neighbouring node's arrow. */
export function neighbourOfEdge(edge: CanvasEdge, key: ArrowKey): CanvasNode | CanvasEdge | null {
	const parent = edge.from.node;
	const child = edge.to.node;
	if (branchEdgeBetween(parent, child) !== edge) return null;
	const root = rootOf(child);
	const structure = structureOf(root, buildTree(root));
	const dir: Dir = structure === "down" ? "down" : sideOf(child, root);
	if (key === AWAY[dir]) return child;
	if (key === BACK[dir]) return parent;
	const other = neighbour(child, key);
	const otherParent = other && parentOf(other);
	return other && otherParent ? branchEdgeBetween(otherParent, other) ?? null : null;
}
