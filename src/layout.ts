// Tree layout on outlines. Pure: no Obsidian or canvas types, so it can be unit tested and benchmarked.
//
// A subtree is laid out in its own frame: u grows away from the root, v runs along the siblings.
// Its outline is kept as two step functions of u (the lowest top edge and the highest bottom edge),
// so fitting a sibling against everything placed before it is one sweep over both, instead of
// comparing every pair of rectangles.

/** One step of an outline: over [u1, u2) the edge sits at v. Steps are sorted by u and never overlap. */
export interface Seg { u1: number; u2: number; v: number }

export interface Outline { top: Seg[]; bottom: Seg[] }

/**
 * A node's size in the layout frame: `su` along u, `sv` along v. `pre` is room kept free before the
 * node along v, `lead` along u (the file name shown above a file node).
 */
export interface NodeSize { su: number; sv: number; pre: number; lead: number }

export interface ShapeOptions {
	/** Distance from a node to its children, along u. */
	hGap: number;
	/** Distance between siblings, along v. */
	sibGap: number;
	/** Siblings fit into each other's free space instead of each taking a full band. */
	compact: boolean;
}

export interface Offset { u: number; v: number }

function shift(segs: Seg[], du: number, dv: number): Seg[] {
	return segs.map((s) => ({ u1: s.u1 + du, u2: s.u2 + du, v: s.v + dv }));
}

/** Both outlines as one: where both cover a stretch of u, `pick` chooses the edge. */
export function mergeSteps(a: Seg[], b: Seg[], pick: (x: number, y: number) => number): Seg[] {
	const out: Seg[] = [];
	const push = (u1: number, u2: number, v: number) => {
		if (u2 <= u1) return;
		const last = out[out.length - 1];
		if (last && last.u2 === u1 && last.v === v) last.u2 = u2;
		else out.push({ u1, u2, v });
	};
	let i = 0;
	let j = 0;
	let u = -Infinity; // everything before u is already written
	while (i < a.length && j < b.length) {
		const sa = a[i];
		const sb = b[j];
		const a1 = Math.max(sa.u1, u);
		const b1 = Math.max(sb.u1, u);
		if (sa.u2 <= b1) {
			push(a1, sa.u2, sa.v);
			u = sa.u2;
			i++;
		} else if (sb.u2 <= a1) {
			push(b1, sb.u2, sb.v);
			u = sb.u2;
			j++;
		} else {
			const start = Math.max(a1, b1);
			if (a1 < start) push(a1, start, sa.v);
			else if (b1 < start) push(b1, start, sb.v);
			const end = Math.min(sa.u2, sb.u2);
			push(start, end, pick(sa.v, sb.v));
			u = end;
			if (sa.u2 === end) i++;
			if (sb.u2 === end) j++;
		}
	}
	for (; i < a.length; i++) push(Math.max(a[i].u1, u), a[i].u2, a[i].v);
	for (; j < b.length; j++) push(Math.max(b[j].u1, u), b[j].u2, b[j].v);
	return out;
}

/** Largest a.v - b.v over the stretches of u both cover (b shifted by du); -Infinity if they share none. */
export function maxDiff(a: Seg[], b: Seg[], du = 0): number {
	let best = -Infinity;
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const sa = a[i];
		const b1 = b[j].u1 + du;
		const b2 = b[j].u2 + du;
		if (sa.u1 < b2 && b1 < sa.u2) best = Math.max(best, sa.v - b[j].v);
		if (sa.u2 < b2) i++;
		else j++;
	}
	return best;
}

/** Extent of an outline along v. */
export function span(o: Outline): number {
	let min = Infinity;
	let max = -Infinity;
	for (const s of o.top) min = Math.min(min, s.v);
	for (const s of o.bottom) max = Math.max(max, s.v);
	return max - min;
}

/**
 * Place `kids` (and everything below them) beside `node`. Each sibling goes as close to the previous
 * ones as its own outline allows (compact) or below their whole band (not compact); the parent is
 * centred on its children. Every placed node's offset from its parent is written to `rel`.
 */
export function shapeOf<T>(
	node: T,
	kids: readonly T[],
	kidsOf: (n: T) => readonly T[],
	sizeOf: (n: T) => NodeSize,
	opts: ShapeOptions,
	rel: Map<T, Offset>,
): Outline {
	const own = sizeOf(node);
	const top: Seg[] = [{ u1: 0, u2: own.su, v: -own.pre }];
	const bottom: Seg[] = [{ u1: 0, u2: own.su, v: own.sv }];
	if (!kids.length) return { top, bottom };

	let accTop: Seg[] = [];
	let accBottom: Seg[] = [];
	let prevEnd = -Infinity;
	let first = 0;
	let last = 0;
	kids.forEach((k, i) => {
		let sub = shapeOf(k, kidsOf(k), kidsOf, sizeOf, opts, rel);
		const ks = sizeOf(k);
		const du = own.su + opts.hGap + ks.lead;
		if (!opts.compact) {
			// The whole subtree as one band.
			let minV = Infinity;
			let maxV = -Infinity;
			let maxU = 0;
			for (const s of sub.top) minV = Math.min(minV, s.v);
			for (const s of sub.bottom) {
				maxV = Math.max(maxV, s.v);
				maxU = Math.max(maxU, s.u2);
			}
			sub = { top: [{ u1: 0, u2: maxU, v: minV }], bottom: [{ u1: 0, u2: maxU, v: maxV }] };
		}
		// Keep the order: this node starts below the previous sibling node.
		let dv = i === 0 ? 0 : prevEnd + opts.sibGap + ks.pre;
		const push = maxDiff(accBottom, sub.top, du);
		if (push > -Infinity) dv = Math.max(dv, push + opts.sibGap);
		accTop = mergeSteps(accTop, shift(sub.top, du, dv), Math.min);
		accBottom = mergeSteps(accBottom, shift(sub.bottom, du, dv), Math.max);
		rel.set(k, { u: du, v: dv });
		if (i === 0) first = dv;
		prevEnd = dv + ks.sv;
		last = prevEnd;
	});
	// Centre the parent on its children nodes.
	const off = own.sv / 2 - (first + last) / 2;
	for (const k of kids) (rel.get(k) as Offset).v += off;
	for (const s of accTop) top.push({ u1: s.u1, u2: s.u2, v: s.v + off });
	for (const s of accBottom) bottom.push({ u1: s.u1, u2: s.u2, v: s.v + off });
	return { top, bottom };
}

/** Offsets from `root` of everything below `kids`, from the parent-relative offsets shapeOf wrote. */
export function positions<T>(kids: readonly T[], kidsOf: (n: T) => readonly T[], rel: Map<T, Offset>): Map<T, Offset> {
	const at = new Map<T, Offset>();
	const stack: { n: T; u: number; v: number }[] = kids.map((n) => ({ n, u: 0, v: 0 }));
	while (stack.length) {
		const { n, u, v } = stack.pop() as { n: T; u: number; v: number };
		const r = rel.get(n);
		if (!r) continue;
		const p = { u: u + r.u, v: v + r.v };
		at.set(n, p);
		for (const k of kidsOf(n)) stack.push({ n: k, u: p.u, v: p.v });
	}
	return at;
}
