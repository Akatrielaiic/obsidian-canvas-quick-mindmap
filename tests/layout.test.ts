import { describe, expect, it } from "vitest";
import { NodeSize, Offset, ShapeOptions, mergeSteps, maxDiff, positions, shapeOf, span } from "../src/layout";

interface N { id: number; size: NodeSize; kids: N[] }
interface Rect { u1: number; v1: number; u2: number; v2: number }

/** The layout as it was before outlines: every rectangle of a subtree against every one placed before. */
function reference(node: N, kids: N[], opts: ShapeOptions): { rects: Rect[]; at: Map<N, Offset> } {
	const own = node.size;
	const rects: Rect[] = [{ u1: 0, v1: -own.pre, u2: own.su, v2: own.sv }];
	const at = new Map<N, Offset>([[node, { u: 0, v: 0 }]]);
	if (!kids.length) return { rects, at };
	const childRects: Rect[] = [];
	const childAt = new Map<N, Offset>();
	let prevEnd = -Infinity;
	let first = 0;
	let last = 0;
	kids.forEach((k, i) => {
		const sub = reference(k, k.kids, opts);
		const du = own.su + opts.hGap + k.size.lead;
		const outline = opts.compact
			? sub.rects
			: [{ u1: Math.min(...sub.rects.map((r) => r.u1)), v1: Math.min(...sub.rects.map((r) => r.v1)), u2: Math.max(...sub.rects.map((r) => r.u2)), v2: Math.max(...sub.rects.map((r) => r.v2)) }];
		let dv = i === 0 ? 0 : prevEnd + opts.sibGap + k.size.pre;
		for (const p of childRects) for (const r of outline) if (r.u1 + du < p.u2 && p.u1 < r.u2 + du) dv = Math.max(dv, p.v2 + opts.sibGap - r.v1);
		for (const r of outline) childRects.push({ u1: r.u1 + du, v1: r.v1 + dv, u2: r.u2 + du, v2: r.v2 + dv });
		for (const [n, p] of sub.at) childAt.set(n, { u: p.u + du, v: p.v + dv });
		if (i === 0) first = dv;
		prevEnd = dv + k.size.sv;
		last = prevEnd;
	});
	const off = own.sv / 2 - (first + last) / 2;
	for (const r of childRects) rects.push({ u1: r.u1, v1: r.v1 + off, u2: r.u2, v2: r.v2 + off });
	for (const [n, p] of childAt) at.set(n, { u: p.u, v: p.v + off });
	return { rects, at };
}

function rng(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

function randomTree(rand: () => number, count: number): N {
	const make = (id: number): N => ({
		id,
		size: { su: 80 + Math.floor(rand() * 240), sv: 60 + Math.floor(rand() * 120), pre: rand() < 0.2 ? 30 : 0, lead: 0 },
		kids: [],
	});
	const nodes = [make(0)];
	for (let i = 1; i < count; i++) {
		const n = make(i);
		nodes[Math.floor(rand() * nodes.length)].kids.push(n);
		nodes.push(n);
	}
	return nodes[0];
}

function layout(root: N, opts: ShapeOptions) {
	const rel = new Map<N, Offset>();
	const outline = shapeOf(root, root.kids, (n) => n.kids, (n) => n.size, opts, rel);
	return { outline, at: positions(root.kids, (n) => n.kids, rel) };
}

describe("step functions", () => {
	it("merges overlapping and separate stretches", () => {
		const a = [{ u1: 0, u2: 10, v: 5 }, { u1: 20, u2: 30, v: 1 }];
		const b = [{ u1: 5, u2: 25, v: 3 }];
		expect(mergeSteps(a, b, Math.max)).toEqual([
			{ u1: 0, u2: 10, v: 5 },
			{ u1: 10, u2: 25, v: 3 },
			{ u1: 25, u2: 30, v: 1 },
		]);
		expect(mergeSteps(a, b, Math.min)).toEqual([
			{ u1: 0, u2: 5, v: 5 },
			{ u1: 5, u2: 20, v: 3 },
			{ u1: 20, u2: 30, v: 1 },
		]);
		expect(mergeSteps([], b, Math.max)).toEqual(b);
	});

	it("only compares stretches both cover", () => {
		const a = [{ u1: 0, u2: 10, v: 100 }, { u1: 10, u2: 20, v: 7 }];
		expect(maxDiff(a, [{ u1: 10, u2: 15, v: 2 }])).toBe(5);
		expect(maxDiff(a, [{ u1: 20, u2: 30, v: 2 }])).toBe(-Infinity);
		expect(maxDiff(a, [{ u1: 0, u2: 5, v: 2 }], 10)).toBe(5);
	});
});

describe("shapeOf", () => {
	for (const compact of [true, false]) {
		it(`matches the rectangle-by-rectangle layout (compact: ${compact})`, () => {
			const rand = rng(compact ? 1 : 2);
			for (let round = 0; round < 60; round++) {
				const root = randomTree(rand, 1 + Math.floor(rand() * 60));
				const opts = { hGap: 40 + Math.floor(rand() * 200), sibGap: Math.floor(rand() * 60), compact };
				const want = reference(root, root.kids, opts);
				const got = layout(root, opts);
				expect(got.at.size).toBe(want.at.size - 1);
				for (const [n, p] of got.at) {
					const w = want.at.get(n) as Offset;
					expect(p.u).toBeCloseTo(w.u, 6);
					expect(p.v).toBeCloseTo(w.v, 6);
				}
				const wantSpan = Math.max(...want.rects.map((r) => r.v2)) - Math.min(...want.rects.map((r) => r.v1));
				expect(span(got.outline)).toBeCloseTo(wantSpan, 6);
			}
		});
	}

	it("never lets two nodes overlap", () => {
		const rand = rng(7);
		for (let round = 0; round < 30; round++) {
			const root = randomTree(rand, 80);
			const { at } = layout(root, { hGap: 160, sibGap: 20, compact: true });
			const boxes = [...at].map(([n, p]) => ({ u1: p.u, u2: p.u + n.size.su, v1: p.v - n.size.pre, v2: p.v + n.size.sv }));
			boxes.push({ u1: 0, u2: root.size.su, v1: -root.size.pre, v2: root.size.sv });
			for (let i = 0; i < boxes.length; i++) {
				for (let j = i + 1; j < boxes.length; j++) {
					const a = boxes[i];
					const b = boxes[j];
					const apart = a.u2 <= b.u1 || b.u2 <= a.u1 || a.v2 + 20 <= b.v1 + 1e-6 || b.v2 + 20 <= a.v1 + 1e-6;
					expect(apart).toBe(true);
				}
			}
		}
	});

	it("lays out a map of several thousand nodes quickly", () => {
		const root = randomTree(rng(3), 5000);
		const start = performance.now();
		const { at } = layout(root, { hGap: 160, sibGap: 20, compact: true });
		expect(at.size).toBe(4999);
		expect(performance.now() - start).toBeLessThan(1000);
	});
});
