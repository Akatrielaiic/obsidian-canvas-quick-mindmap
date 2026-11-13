// Markdown list <-> tree. Pure, so it can be unit tested.

export interface OutlineItem { text: string; children: OutlineItem[] }

/** Columns of leading white space; a tab reaches the next multiple of four. */
function indentOf(line: string): number {
	let n = 0;
	for (const ch of line) {
		if (ch === " ") n++;
		else if (ch === "\t") n += 4 - (n % 4);
		else break;
	}
	return n;
}

const BULLET = /^(?:[-*+]|\d+[.)])(?:\s+(.*))?$/;
const TASK = /^\[[ xX]\]\s/;
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * A nested list (bullets, numbers, or bare indented lines), optionally under headings, as a tree.
 * Headings nest by their level and own the lists below them; an indented line without a bullet
 * continues the bullet above it.
 */
export function parseOutline(src: string): OutlineItem[] {
	const roots: OutlineItem[] = [];
	// Open ancestors, outermost first. Headings carry their level, list items their indent.
	const open: { item: OutlineItem; heading: number; indent: number; bullet: boolean }[] = [];
	const add = (text: string, heading: number, indent: number, bullet = false) => {
		const item: OutlineItem = { text, children: [] };
		const parent = open[open.length - 1];
		(parent ? parent.item.children : roots).push(item);
		open.push({ item, heading, indent, bullet });
	};
	for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
		const rest = line.trim();
		if (!rest) continue;
		const indent = indentOf(line);
		const heading = indent === 0 ? HEADING.exec(rest) : null;
		if (heading) {
			const level = heading[1].length;
			while (open.length && (!open[open.length - 1].heading || open[open.length - 1].heading >= level)) open.pop();
			add(heading[2].trim(), level, -1);
			continue;
		}
		const bullet = BULLET.exec(rest);
		const top = open[open.length - 1];
		if (!bullet && top?.bullet && indent > top.indent) {
			top.item.text += (top.item.text ? "\n" : "") + rest;
			continue;
		}
		while (open.length && !open[open.length - 1].heading && open[open.length - 1].indent >= indent) open.pop();
		let text = bullet ? (bullet[1] ?? "").trim() : rest;
		if (bullet && TASK.test(text)) text = `- ${text}`; // stays a checkbox inside the node
		add(text, 0, indent, !!bullet);
	}
	return roots;
}

/** The tree as a tab-indented bullet list; further lines of an item are indented under its bullet. */
export function formatOutline(items: OutlineItem[]): string {
	const out: string[] = [];
	const walk = (list: OutlineItem[], depth: number) => {
		const pad = "\t".repeat(depth);
		for (const item of list) {
			const lines = item.text.split("\n").filter((l) => l.trim());
			const firstLine = (lines[0] ?? "").trim();
			// A task keeps its own "- [ ]" bullet.
			out.push(pad + (/^- \[[ xX]\]\s/.test(firstLine) ? firstLine : `- ${firstLine}`));
			for (const l of lines.slice(1)) out.push(`${pad}  ${l.trim()}`);
			walk(item.children, depth + 1);
		}
	};
	walk(items, 0);
	return out.join("\n");
}
