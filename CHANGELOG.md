# Changelog

## 0.3.0

New:

- **Arrow keys move between nodes.** With a node selected: toward the root for the parent, away from it for the nearest child, across for the previous or next node on the same level (a sibling, or the neighbouring branch's node). Follows the map's structure, so in a downward map Down is the child. Setting *Arrow keys move between nodes* (on by default) gives the keys back to Canvas.
- **Alt+arrow reorders siblings.** Alt+Up / Alt+Down (Alt+Left / Alt+Right in a downward map) trade the node's place with its neighbour and lay the map out again. Also as commands: *Move node before its previous sibling*, *Move node after its next sibling*.
- **Collapse and expand branches.** A button on the selected node (or the *Collapse or expand branch* command) hides everything below it; a badge shows how many nodes are hidden, and a click on it opens the branch again. Layout closes the gap. The nodes stay in the `.canvas` file, only hidden, so nothing is lost without the plugin; which branches are collapsed is kept in the plugin's data. Searching opens the branch a result is in. Command: *Expand all branches*.
- **New nodes take the branch's colour** (setting, on by default): the node's colour comes from the node it was added from, the arrow's from that node's arrow.
- **Markdown lists.** *Copy map as Markdown list* puts the selected branch (or every map) on the clipboard as a nested list; *Paste Markdown list as map* turns a nested list, with or without headings, into branches of the selected node or into new maps.

Faster:

- **Layout on outlines.** Each subtree keeps the outline of its top and bottom edge instead of the list of all its rectangles, so placing a sibling is one sweep rather than a comparison of every pair. Same positions as before (checked against the old algorithm on random trees); the layout pass for a 5,000-node map takes under 10 ms.
- **Measured sizes are remembered** by text and maximum width, until the theme, the fonts or the settings change. Tidying a canvas no longer measures every unchanged node again.
- Typing in an ordinary note no longer scans the open canvases for the node being edited.
- Tidy routes links once, not once per tree and again for the whole canvas.

Fixed:

- Tidy (command and toolbar button) no longer changes a read-only canvas.
- The selection menu is patched with `monkey-around`, so turning the plugin off removes its patch even when another plugin patched the same menu later.
- Search: Enter pressed right after typing walks the new results, not the previous ones.
- Timers still waiting to resize a node are cancelled when the plugin unloads.

Under the hood: the source is split into modules, with unit tests (`npm test`) for layout, tree reading, link renaming and Markdown lists; ESLint with `eslint-plugin-obsidianmd` (`npm run lint`); TypeScript `strict`; CI on every push and pull request. `main.js` is no longer committed: releases build it. CSS classes are now prefixed `arbor-` (was `cqm-`), in case a snippet of yours targets them.

## 0.2.0: Canvas Arbor

First release under the new name and plugin id `canvas-arbor`, based on Canvas Quick Mindmap 0.1.1 by RainaJIA716.

- **Three map structures: right, both sides, downward.** Read from the map (branches left of the root, or root arrows leaving from below), nothing stored. Left-half branches grow leftward with left-to-right arrows; downward maps use bottom-to-top arrows and lay siblings out in rows.
- **Automatic balancing.** When the root reaches *Two sides from this many branches* (5 by default) the map spreads over both sides once, clockwise; new root branches go to the shorter side; sides are sticky. Commands: *Balance map on both sides*, *Map grows to the right*, *Map grows downward*.
- **Compact layout** (setting, on by default): each sibling subtree goes as close as its outline allows instead of reserving a full band; parents are centred on their children.
- Branch arrows recognised in all three looks (right-left, left-right, bottom-top); an arrow of one of these looks pointing back toward its source's parent is a link. Links never take a branch look when routed.
- **Shift+Tab selects the parent node**, while typing or with a node selected, ready for Tab / Enter. Also available as the "Select parent node" command.
- **New setting: Tab adds a child, Enter a sibling.** Swaps the two keys while typing, for people used to other mind map apps. Off by default, so nothing changes for existing users.
- **New setting: Keyboard shortcuts on mobile.** With a hardware keyboard on a phone or tablet, Enter adds nodes while typing, as on desktop. Off by default.
- Cmd+F opens canvas search on iPad / iPhone with a hardware keyboard (it expected Ctrl+F there).
- **Nodes are no longer shrunk while the canvas is hidden.** Measuring text in a hidden canvas (background tab, switching workspaces or desktops) read every width as 0, so fitted nodes collapsed to 80x60. Measuring now waits until the canvas is visible.
- **Auto-size never splits a word.** A node is at least as wide as its longest word ("Macro" no longer shows as "Mac / ro"), growing past the max width if a single word needs it. Text is now measured beside a paragraph of a real node on screen, so custom themes and fonts no longer make nodes a few pixels too narrow.
- **Hand-drawn extra arrows no longer reshape the map.** New setting *Extra arrows are links* (on by default): each node has one branch arrow (right-to-left first, then from a node on its left, then the oldest); other arrows, arrows pointing back to the left and arrows that would close a loop are links. Layout and tidy ignore links: nodes are not moved under a second parent, two maps joined by an arrow stay separate, and Enter no longer adds a sibling under the wrong parent.
- **New setting: Route links around nodes** (on by default). After layout and tidy, each link is reattached to the pair of sides whose curve crosses the fewest other nodes, then is shortest. Right-to-left is kept for branches, so a link never turns into one.
- New child nodes start to the right of their parent instead of on top of it.
- **Renaming a pasted attachment only rewrites whole links.** Renaming `1.png` no longer touches `image-1.png` in text nodes.
- Typing in ordinary notes no longer scans canvas nodes when no canvas is open.
- Disabling the plugin removes its toolbar buttons from popout windows too.
- Closed canvases are no longer kept in memory by the find key and search bar.

## 0.1.1

Addresses the automated community review of 0.1.0. No change in what the plugin does.

- **No longer lists every file in the vault.** Renaming a pasted image needs a name no other file has. 0.1.0 checked that by listing all vault files; 0.1.1 asks Obsidian's link resolution whether the name is taken, which gives the same guarantee. The review's "Vault Enumeration" note goes away.
- Removed a redundant type assertion flagged by the review's lint.

## 0.1.0

First release: Enter / Tab to add child and sibling nodes while typing, Enter to edit a selected node, + buttons on the selected node, automatic layout, Tidy button, nodes that fit their text, canvas search (Cmd/Ctrl+F), copy image nodes, rename images pasted into a canvas.
