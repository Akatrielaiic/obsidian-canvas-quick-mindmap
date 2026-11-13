# Canvas Arbor

Mind maps on Obsidian Canvas, from the keyboard. Based on
[Canvas Quick Mindmap](https://github.com/RainaJIA716/obsidian-canvas-quick-mindmap)
by RainaJIA716, with three map structures (right, both sides, downward),
balanced and compact layout, hand-drawn arrows kept as links and routed around
cards, and several fixes.

Obsidian Canvas is a great place to think, but building a mind map in it is slow:
create a card, drag it into place, drag an edge from one card to the other, resize,
repeat. Canvas Arbor turns that into typing. Press **Enter** and the next
idea appears to the right, already connected and ready for text. Press **Tab** and
it appears below, on the same level. The canvas stays a normal `.canvas` file —
nothing new to learn, nothing locked in.

## Features

- **Type your map.** While editing a node, **Enter** adds a child node and **Tab**
  adds a sibling. **Shift+Enter** is a line break. The new node is connected,
  placed and opened for typing.
- **Keyboard on a selected node.** **Enter** edits it (cursor at the end), **Tab**
  adds a child.
- **Move around with Shift+arrow.** With a node selected, **Shift+arrow** goes
  to its parent, its nearest child, or the previous / next node on the same
  level. **Alt+arrow** moves the node before or after its sibling. Plain arrows
  still nudge the card, as Canvas does.
- **Collapse branches.** The chevron button on a selected node hides everything
  below it; a badge shows how many nodes are hidden, click it to open the branch
  again. The map closes the gap. Hidden nodes stay in the `.canvas` file.
- **+ buttons on the node.** Select a node and two round **+** buttons appear: right
  for a child, below for a sibling. They work on phones and tablets too.
- **Automatic layout, three structures.** Each map grows to the right, on both
  sides of its central node (like MindNode), or downward like an org chart.
  The structure is read from the map itself: branches left of the central node
  mean both sides, arrows leaving it from below mean downward. Branches fit
  into each other's free space, so nothing overlaps and little space is wasted.
- **Balanced maps.** From 5 branches on the central node (adjustable), the map
  keeps them even on both sides, in MindNode's clockwise order: whenever you
  add a branch to the central node, and when you tidy. With an odd count the
  right side gets the extra one. Commands: *Balance map on both sides*, *Map grows to the right*,
  *Map grows downward* (selected map, or every map when nothing is selected).
- **Tidy button.** One click in the canvas toolbar re-lays out every tree on the
  canvas, points branch arrows the way their branch grows, pulls overlapping
  trees apart and moves loose cards out of the way. One undo restores everything.
- **Nodes fit their text.** Mind map nodes grow and shrink as you type; long text
  wraps at a maximum width instead of making a huge card. Notes, images, code
  blocks, tables and headings keep their size.
- **Search the canvas.** **Cmd/Ctrl+F** (or the magnifier in the toolbar) opens a
  find bar. It searches card text, group labels, links, file names and the
  content of embedded notes. Matches are highlighted, the rest dimmed;
  **Enter / Shift+Enter** jump between them, **Esc** closes and leaves the
  result selected so Enter edits it.
- **Branch colours.** A new node takes the colour of the node it was added
  from, so a coloured branch stays coloured as it grows.
- **Markdown lists in and out.** *Copy map as Markdown list* puts the selected
  branch (or every map) on the clipboard as a nested list; *Paste Markdown list
  as map* turns a nested list, with or without headings, into branches of the
  selected node, or into new maps when nothing is selected.
- **Copy image nodes.** Select an image and click the copy button in its corner
  to put the full-size picture on the clipboard (WebP, GIF, SVG and others are
  converted to PNG).
- **Pasted images get real names.** Images pasted or dropped into a canvas are
  renamed after the canvas (`Plan.png`, `Plan-1.png`…), the way Paste Image
  Rename does it for notes — including links inside text cards.
- English and Chinese interface, following Obsidian's language.

## Keys

| Key | While typing in a node | Node selected |
|---|---|---|
| Enter | New child node | Edit the node |
| Tab | New sibling node | New child node |
| Shift+Tab | Select the parent node | Select the parent node |
| Shift+Enter | Line break | — |
| Shift+arrow | Select text | Go to the parent, child or neighbouring node |
| Alt+Up / Alt+Down | — | Move the node before / after its sibling |
| Cmd/Ctrl+F | Search the canvas | Search the canvas |

With **Tab adds a child, Enter a sibling** turned on, Enter and Tab swap
roles while typing (Tab: new child, Enter: new sibling), as in most mind map
apps.

In a downward map the reordering keys are Alt+Left / Alt+Right. Collapsing has
no key of its own: give *Collapse or expand branch* a hotkey if you want one.

Enter is never taken while an input method (Chinese, Japanese…) is still
choosing characters.

## Use cases

- Brainstorm on a canvas without touching the mouse: type, Enter, type, Tab.
- Turn a messy canvas into a clean tree with one click.
- Find the card you wrote last week on a big canvas.
- Paste screenshots into a canvas and get sensible file names.

## Settings

- **Auto layout** — rearrange the tree after each new node (off: keep your
  manual positions and place new nodes in the nearest free spot).
- **Enter adds a node while typing** — off keeps Enter as a line break.
- **Tab adds a child, Enter a sibling** — swap the two keys while typing.
- **Shift+arrow moves between nodes** — off leaves Shift+arrow to Canvas.
- **Compact layout** — branches use each other's free space (off: each branch
  takes a full-height band).
- **Balance on both sides from this many branches** — from this count on, the
  central node's branches are kept even on both sides (0: never).
- **Extra arrows are links** — a node with several incoming arrows keeps one
  as its branch (right-to-left first, then the one from a node on its left,
  then the oldest). The others, and arrows pointing back to the left, are links:
  layout and tidy don't move nodes for them or change their sides, and two maps
  joined by a link stay two maps. Off: every arrow is a branch, as before.
- **Route links around nodes** — after layout and tidy, links are reattached to
  the sides that keep them short and off other nodes.
- **Keyboard shortcuts on mobile** — on a phone or tablet with a hardware
  keyboard, Enter adds nodes while typing as on desktop (off by default, so the
  on-screen keyboard's Enter stays a line break).
- **Horizontal / vertical gap** — spacing of the tree. Below 160 px horizontal,
  Obsidian's curved edges start to loop back.
- **New nodes take the branch's colour**.
- **Fit nodes to their text** and **maximum node width**.
- **Rename attachments pasted into a canvas**.

## Notes

- Works on the canvas Obsidian already has; it uses Canvas's internal API, which
  is not officially documented, and is tested on Obsidian 1.14.
- Only nodes that are part of a mind map (have an edge) resize while you type,
  so ordinary cards on a canvas are left alone.
- Collapsed branches are remembered in the plugin's data, per canvas file. If
  that data is lost (or the plugin is off) the branches are simply all open.
- Renaming only touches files that the open canvas actually uses within a few
  seconds of them appearing, so files created by sync or other plugins are left
  alone.

## Install

Canvas Arbor is not in the Community plugins directory. Install it with
[BRAT](https://github.com/TfTHacker/obsidian42-brat) (*Add beta plugin*, then
this repository), which also keeps it up to date, or copy `main.js`,
`manifest.json` and `styles.css` from the latest release into
`<vault>/.obsidian/plugins/canvas-arbor/`.

It has its own plugin id, so it can sit next to Canvas Quick Mindmap; enable
only one of the two.

## Development

`npm ci`, then `npm run dev` (watch), `npm run build`, `npm test`, `npm run lint`.
The layout (`src/layout.ts`), tree reading (`src/tree.ts`), link renaming
(`src/text.ts`) and Markdown lists (`src/outline.ts`) have unit tests in `tests/`.

## 中文说明

把 Obsidian 画布当思维导图用：输入时 **Enter** 新建子节点、**Tab** 新建同级节点，
自动连线、自动排版；选中节点按 **Enter** 编辑；节点旁边的 **+** 按钮手机上也能用；
右侧工具栏一键「整理导图」；节点大小跟随文字；**⌘F** 搜索画布；图片节点一键复制；
粘贴进画布的图片按画布名重命名。选中节点后**Shift+方向键**在节点间移动，**Alt+方向键**调整同级顺序；
分支可以折叠 / 展开；新节点沿用分支颜色；导图可以复制为 Markdown 列表，列表也可以粘贴成导图。

## Credits and license

Canvas Arbor started as a fork of
[Canvas Quick Mindmap](https://github.com/RainaJIA716/obsidian-canvas-quick-mindmap)
by RainaJIA716. MIT, see [LICENSE](LICENSE).
