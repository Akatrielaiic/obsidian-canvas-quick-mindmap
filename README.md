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
- **+ buttons on the node.** Select a node and two round **+** buttons appear: right
  for a child, below for a sibling. They work on phones and tablets too.
- **Automatic layout, three structures.** Each map grows to the right, on both
  sides of its central node (like MindNode), or downward like an org chart.
  The structure is read from the map itself: branches left of the central node
  mean both sides, arrows leaving it from below mean downward. Branches fit
  into each other's free space, so nothing overlaps and little space is wasted.
- **Balanced maps.** When the central node gets 5 branches (adjustable), the
  map spreads them over both sides once, in MindNode's clockwise order. New
  branches go to the shorter side; a branch you drag to the other side stays
  there. Commands: *Balance map on both sides*, *Map grows to the right*,
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
| Cmd/Ctrl+F | Search the canvas | Search the canvas |

With **Tab adds a child, Enter a sibling** turned on, Enter and Tab swap
roles while typing (Tab: new child, Enter: new sibling), as in most mind map
apps.

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
- **Compact layout** — branches use each other's free space (off: each branch
  takes a full-height band).
- **Two sides from this many branches** — when to balance a one-sided map
  automatically (0: never).
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
- **Fit nodes to their text** and **maximum node width**.
- **Rename attachments pasted into a canvas**.

## Notes

- Works on the canvas Obsidian already has; it uses Canvas's internal API, which
  is not officially documented, and is tested on Obsidian 1.14.
- Only nodes that are part of a mind map (have an edge) resize while you type,
  so ordinary cards on a canvas are left alone.
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

## 中文说明

把 Obsidian 画布当思维导图用：输入时 **Enter** 新建子节点、**Tab** 新建同级节点，
自动连线、自动排版；选中节点按 **Enter** 编辑；节点旁边的 **+** 按钮手机上也能用；
右侧工具栏一键「整理导图」；节点大小跟随文字；**⌘F** 搜索画布；图片节点一键复制；
粘贴进画布的图片按画布名重命名。

## Credits and license

Canvas Arbor started as a fork of
[Canvas Quick Mindmap](https://github.com/RainaJIA716/obsidian-canvas-quick-mindmap)
by RainaJIA716. MIT, see [LICENSE](LICENSE).
