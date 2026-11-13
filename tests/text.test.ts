import { describe, expect, it } from "vitest";
import { applyReplacements, linkOccurrences, mentions, plainText, replacements } from "../src/text";

describe("plainText", () => {
	it("gives up on content that does not render as its characters", () => {
		for (const md of ["![[a.png]]", "```js\nx\n```", "| a | b |", "# Title", "$$x$$"]) expect(plainText(md)).toBeNull();
	});
	it("reads links, lists and emphasis as they show", () => {
		expect(plainText("[[folder/Note#h|shown]] and [[folder/Note]]")).toBe("shown and Note");
		expect(plainText("[text](https://example.com)")).toBe("text");
		expect(plainText("- [ ] task\n- item")).toBe("☐ task\n• item");
		expect(plainText("**bold** and *it* and `code`\n\n")).toBe("bold and it and code");
	});
});

describe("renaming links", () => {
	it("only matches a whole file name", () => {
		expect(linkOccurrences("![[image-1.png]] ![[1.png]]", "1.png")).toEqual([20]);
		expect(mentions("see [[a/pic.png|x]]", "pic.png")).toBe(true);
		expect(mentions("picture.png", "pic.png")).toBe(false);
	});
	it("rewrites wikilinks and encoded Markdown links", () => {
		const text = "![[Pasted image 1.png]] and ![](Pasted%20image%201.png)";
		const out = applyReplacements(text, replacements(text, "Pasted image 1.png", "My map.png"));
		expect(out).toBe("![[My map.png]] and ![](My%20map.png)");
	});
});
