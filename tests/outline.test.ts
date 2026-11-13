import { describe, expect, it } from "vitest";
import { formatOutline, parseOutline } from "../src/outline";

const texts = (items: ReturnType<typeof parseOutline>): unknown => items.map((i) => (i.children.length ? [i.text, texts(i.children)] : i.text));

describe("parseOutline", () => {
	it("nests bullets by indentation, tabs or spaces", () => {
		const src = "- a\n\t- b\n\t\t- c\n\t- d\n- e\n  1. f\n  2) g";
		expect(texts(parseOutline(src))).toEqual([["a", [["b", ["c"]], "d"]], ["e", ["f", "g"]]]);
	});
	it("puts lists under headings and nests headings by level", () => {
		const src = "# Top\n\n## One\n- a\n  - b\n## Two\nplain line\n# Other";
		expect(texts(parseOutline(src))).toEqual([["Top", [["One", [["a", ["b"]]]], ["Two", ["plain line"]]]], "Other"]);
	});
	it("joins continuation lines and keeps tasks as checkboxes", () => {
		const items = parseOutline("- first\n  second line\n- [ ] todo\n-");
		expect(items.map((i) => i.text)).toEqual(["first\nsecond line", "- [ ] todo", ""]);
	});
	it("reads bare indented lines as a tree", () => {
		expect(texts(parseOutline("a\n    b\n    c\nd"))).toEqual([["a", ["b", "c"]], "d"]);
	});
});

describe("formatOutline", () => {
	it("round-trips", () => {
		const src = "- a\n  more\n\t- b\n\t\t- c\n\t- [x] done\n- e";
		expect(formatOutline(parseOutline(src))).toBe(src);
	});
});
