import { afterEach, describe, expect, it } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/canvas";
import { buildTree, forgetBranches, hooks, neighbour, neighbourOfEdge, neighbourVia, parentOf, rootOf, structureOf } from "../src/tree";

/** Just enough of a canvas for the tree code. */
function fake() {
	const canvas = { nodes: new Map<string, CanvasNode>(), edges: new Map<string, CanvasEdge>() } as Canvas;
	canvas.getEdgesForNode = (n) => [...canvas.edges.values()].filter((e) => e.from.node === n || e.to.node === n);
	const node = (id: string, x: number, y: number, type = "text") => {
		const n = { id, x, y, width: 100, height: 60, canvas, getData: () => ({ type }) } as CanvasNode;
		canvas.nodes.set(id, n);
		return n;
	};
	const edge = (from: CanvasNode, to: CanvasNode, fromSide = "right", toSide = "left") => {
		const id = `${from.id}-${to.id}`;
		const e = { id, from: { node: from, side: fromSide }, to: { node: to, side: toSide } } as CanvasEdge;
		canvas.edges.set(id, e);
		forgetBranches(canvas);
		return e;
	};
	return { canvas, node, edge };
}

afterEach(() => {
	hooks.hidden = () => false;
	hooks.collapsed = () => false;
});

describe("branches and links", () => {
	it("keeps one branch per node and treats the rest as links", () => {
		const { node, edge } = fake();
		const root = node("root", 0, 0);
		const a = node("a", 300, -100);
		const b = node("b", 300, 100);
		const c = node("c", 600, 0);
		edge(root, a);
		edge(root, b);
		edge(a, c);
		edge(b, c, "bottom", "bottom"); // hand-drawn: a link
		edge(c, root, "top", "top"); // points back: a link
		expect(parentOf(c)).toBe(a);
		expect(parentOf(root)).toBeNull();
		expect(rootOf(c)).toBe(root);
		const tree = buildTree(root);
		expect(tree.get(root)).toEqual([a, b]);
		expect(tree.get(b)).toEqual([]);
		expect(structureOf(root, tree)).toBe("right");
	});

	it("reads the structure from the map", () => {
		const { node, edge } = fake();
		const root = node("root", 0, 0);
		const l = node("l", -300, 0);
		const r = node("r", 300, 0);
		edge(root, l, "left", "right");
		edge(root, r);
		expect(structureOf(root, buildTree(root))).toBe("both");

		const d = fake();
		const top = d.node("top", 0, 0);
		d.edge(top, d.node("x", -100, 200), "bottom", "top");
		d.edge(top, d.node("y", 100, 200), "bottom", "top");
		expect(structureOf(top, buildTree(top))).toBe("down");
	});

	it("leaves collapsed branches out, unless asked for everything", () => {
		const { node, edge } = fake();
		const root = node("root", 0, 0);
		const a = node("a", 300, 0);
		const b = node("b", 600, 0);
		edge(root, a);
		edge(a, b);
		hooks.collapsed = (n) => n === a;
		hooks.hidden = (n) => n === b;
		expect([...buildTree(root).keys()]).toEqual([root, a]);
		expect([...buildTree(root, true).keys()]).toEqual([root, a, b]);
	});
});

describe("arrow keys", () => {
	it("walks a two-sided map", () => {
		const { node, edge } = fake();
		const root = node("root", 0, 0);
		const r1 = node("r1", 300, -100);
		const r2 = node("r2", 300, 100);
		const r1a = node("r1a", 600, -100);
		const r2a = node("r2a", 600, 100);
		const l1 = node("l1", -300, 0);
		const l1a = node("l1a", -600, 0);
		for (const [p, k] of [[root, r1], [root, r2], [r1, r1a], [r2, r2a]]) edge(p, k);
		edge(root, l1, "left", "right");
		edge(l1, l1a, "left", "right");

		expect(neighbour(root, "ArrowRight")).toBe(r1);
		expect(neighbour(root, "ArrowLeft")).toBe(l1);
		expect(neighbour(root, "ArrowUp")).toBeNull();
		expect(neighbour(r1, "ArrowDown")).toBe(r2);
		expect(neighbour(r1, "ArrowUp")).toBeNull();
		expect(neighbour(r1, "ArrowLeft")).toBe(root);
		expect(neighbour(r1, "ArrowRight")).toBe(r1a);
		expect(neighbour(r1a, "ArrowDown")).toBe(r2a); // across to the next branch
		expect(neighbour(l1, "ArrowLeft")).toBe(l1a);
		expect(neighbour(l1, "ArrowRight")).toBe(root);
		expect(neighbour(l1a, "ArrowRight")).toBe(l1);
	});

	it("walks a downward map", () => {
		const { node, edge } = fake();
		const top = node("top", 0, 0);
		const x = node("x", -100, 200);
		const y = node("y", 100, 200);
		edge(top, x, "bottom", "top");
		edge(top, y, "bottom", "top");
		expect(neighbour(top, "ArrowDown")).toBe(x);
		expect(neighbour(x, "ArrowRight")).toBe(y);
		expect(neighbour(y, "ArrowUp")).toBe(top);
	});

	it("stops on the branch arrows", () => {
		const { node, edge } = fake();
		const root = node("root", 0, 0);
		const r1 = node("r1", 300, -100);
		const r2 = node("r2", 300, 100);
		const l1 = node("l1", -300, 0);
		const toR1 = edge(root, r1);
		const toR2 = edge(root, r2);
		const toL1 = edge(root, l1, "left", "right");
		const link = edge(r1, r2, "bottom", "top");

		expect(neighbourVia(root, "ArrowRight")).toBe(toR1);
		expect(neighbourVia(r1, "ArrowLeft")).toBe(toR1);
		expect(neighbourVia(r1, "ArrowDown")).toBe(r2);
		expect(neighbourOfEdge(toR1, "ArrowRight")).toBe(r1);
		expect(neighbourOfEdge(toR1, "ArrowLeft")).toBe(root);
		expect(neighbourOfEdge(toR1, "ArrowDown")).toBe(toR2);
		expect(neighbourOfEdge(toR2, "ArrowDown")).toBeNull();
		expect(neighbourOfEdge(toL1, "ArrowLeft")).toBe(l1);
		expect(neighbourOfEdge(toL1, "ArrowRight")).toBe(root);
		expect(neighbourOfEdge(link, "ArrowDown")).toBeNull();
	});
});
