// Pure text helpers: no Obsidian imports, so they can be unit tested.

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

export function randomId(): string {
	let s = "";
	for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
	return s;
}

/**
 * Text as it reads on screen, for measuring. Null when the node holds something that renders much
 * bigger or differently than its characters (embeds, code, tables, headings, maths).
 */
export function plainText(md: string): string | null {
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

export interface Replacement { from: number; to: number; insert: string }

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
export function linkOccurrences(text: string, name: string): number[] {
	const out: number[] = [];
	for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + name.length)) {
		const before = text[i - 1];
		const after = text[i + name.length];
		if (LINK_BEFORE.has(before) && (after === undefined || LINK_AFTER.has(after))) out.push(i);
	}
	return out;
}

export function mentions(text: string, name: string): boolean {
	return nameForms(name, name).some(([from]) => linkOccurrences(text, from).length > 0);
}

export function replacements(text: string, oldName: string, newName: string): Replacement[] {
	const out: Replacement[] = [];
	for (const [from, to] of nameForms(oldName, newName)) {
		for (const i of linkOccurrences(text, from)) out.push({ from: i, to: i + from.length, insert: to });
	}
	return out.sort((a, b) => a.from - b.from);
}

export function applyReplacements(text: string, changes: Replacement[]): string {
	let result = "";
	let pos = 0;
	for (const c of changes) {
		result += text.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return result + text.slice(pos);
}
