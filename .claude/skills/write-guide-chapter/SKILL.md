---
name: write-guide-chapter
description: Write or insert a chapter into this repo's photography guide site (攝影教學技巧指南 / photo-primer-guide) — the multi-tab static site covering 攝影基礎 (fund), RICOH GR IV (griv), DJI Osmo Pocket 4 Pro (pocket4pro), and 攝影進階 (advanced, color grading & DaVinci Resolve editing). Use this whenever the user asks to add, write, draft, or insert a new chapter/section into any of these tabs, or to expand/rewrite an existing chapter — even if they just say "寫一篇章節" or "加一章" without naming the file format. Also use it when deciding which tab a piece of photography content belongs in, when linking one chapter to another, or when unsure how the manifest.json / sw.js / cross-linking mechanics in this repo work. Covers the exact HTML template, the site's box/table/diagram/citation conventions, the manifest-driven ordering system, and the checklist for wiring a new chapter in correctly (manifest entry, cross-links, sw.js version bump).
---

# Writing a chapter for this guide

This repo is a static, no-build, no-framework multi-tab site. Every chapter is a
standalone `.html` fragment; a shell (`index.html`) fetches it and injects it.
Getting a chapter "right" here means two things at once: the **prose reads like
the rest of the guide**, and the **mechanics** (file naming, manifest order,
links, cache version) are wired up correctly. Skipping the mechanics is the
most common way a new chapter silently breaks navigation or ends up excluded
from the cached offline build — read `README.md` at the repo root once if
anything below is ambiguous; it's the ground truth this skill is distilled from.

## Step 0: which tab does this belong in?

The repo has exactly one rule for this, and it's worth applying deliberately
rather than defaulting to "whichever tab the user was just talking about":

> **Would this sentence still be true on a different camera?** If yes, it's
> universal — split further by *when* it applies: knowledge you use at the
> moment of shooting (exposure, composition, focus concepts, general
> gear-buying knowledge like memory cards or filters-in-general) goes in
> `content/fund/` (攝影基礎); knowledge you use after the shutter's already
> been pressed (photo color grading, video editing, DaVinci Resolve) goes in
> `content/advanced/` (攝影進階) — it's still camera-agnostic, just a
> different stage of the workflow. If the sentence only makes sense for one
> specific device (a menu path, an exact spec number, a button, "you should
> set X to Y on *this* body"), it belongs in that device's own tab —
> `content/griv/` (RICOH GR IV) or `content/pocket4pro/` (DJI Osmo Pocket 4
> Pro).

When a device chapter needs to reference a universal concept, it should
**link to the fund or advanced chapter in one sentence, not re-explain it**.
If no chapter covers it yet, that's a signal to write the universal part
there and link to it, rather than duplicating theory inside a device tab. Check
`content/fund/manifest.json`'s `files` array first — a chapter may already
exist that covers what you need.

## Step 1: file and manifest mechanics

Each tab is `content/<tab>/` with a `manifest.json` and a `chapters/` folder.
**The `files` array inside that tab's `manifest.json` is the only thing that
determines reading order** — not the filename, not alphabetical sort, not
`ls` order in the folder.

This has one important, slightly counterintuitive consequence for naming a
new file:

- Find the **largest number prefix currently used in that tab's `chapters/`
  folder** and use `+1` for your new file, regardless of where it will
  actually be inserted in the reading order.
- **Never rename or renumber existing files** to make room, even if the new
  chapter conceptually belongs before them. The number in a filename is a
  creation-order ID, not a position — same idea as a database migration
  filename. The *only* place that expresses reading order is the `files`
  array.
- Insert the new filename into `manifest.json`'s `files` array at whatever
  position makes sense for reading order.

Example: if `content/fund/chapters/` currently goes up to `10-memory-cards.html`,
a new chapter there is `11-whatever.html`, even if it should be read second —
you'd place `"11-whatever.html"` as the second entry in the `files` array,
right after `"00-intro.html"`.

After creating the file and updating the manifest, **bump the `VERSION`
constant in `sw.js`** (e.g. `'gr4-v16'` → `'gr4-v17'`) — this is a static
site cached offline by a service worker; without the bump, people who've
visited before keep seeing the old content.

## Step 2: the chapter template

Every chapter file is a single `<section>` with no surrounding `<html>`/`<head>`/
`<body>` — it's a fragment that gets injected. Structure:

```html
<section data-t="章節標題" data-g="側邊欄分組名稱">
<div class="osd">...</div>
<div class="wrap">
<h2 class="ch">章節標題</h2>
<p class="sub">一句話副標,講這章要解決什麼</p>

... body content ...

</div></section>
```

- `data-t` is the chapter title (shown in the sidebar and search index) — keep
  it identical to the `<h2 class="ch">` text.
- `data-g` groups chapters under a shared heading in the sidebar. **Reuse an
  existing group for that tab if the chapter fits one** — check
  `manifest.json`'s neighboring chapters or grep the tab's `chapters/` folder
  for `data-g="` to see current groups (fund: 總覽/曝光原理/構圖思維/攝影眼;
  griv: 入門/攝影原理/操作核心/影像風格/進階功能/拍完之後/速查; pocket4pro:
  基礎認識/基礎設定/常見拍攝手法/進階設定/運鏡技巧/主題運鏡/配件與注意事項; advanced:
  總覽/調色基礎/調色進階/剪輯入門/剪輯進階). Only introduce a
  new group name if the chapter genuinely doesn't fit any existing one —
  a new group of one chapter is fine (fund's "總覽" is precedent).
- No `data-ch` attribute — that was retired when the site moved to
  manifest-array-based ordering.

### The `osd` line — don't copy it blindly, it differs per tab

The `osd` div is a tiny mockup of a camera's on-screen status readout. **Its
content convention is genuinely different between tabs — check which tab
you're in:**

- **fund**, **pocket4pro**, and **advanced** keep it simple and constant
  across every chapter in that tab: `<div class="osd"><span
  class="hot">基礎</span><span class="no"></span></div>` for fund,
  `<div class="osd"><span class="hot">P4P</span><span
  class="no"></span></div>` for pocket4pro, `<div class="osd"><span
  class="hot">進階</span><span class="no"></span></div>` for advanced. Copy
  the right one verbatim for any new chapter in those tabs — don't invent a
  new "hot" label per chapter.
- **griv** chapters instead treat the `osd` row as a small themed mockup of
  what the camera's screen would actually show *while doing the thing that
  chapter teaches* — e.g. the ISO chapter's osd shows `F`/`S`/`ISO`-style
  exposure readouts, the menu-navigation chapter shows `MENU A B C D E`, the
  troubleshooting chapter shows `DEBUG 症狀 原因 解法`. If you're adding a
  griv chapter, look at 2-3 existing ones first (`grep -h 'class="osd"'
  content/griv/chapters/*.html`) and design a small thematic readout that
  fits your chapter's subject, following that pattern rather than the plain
  fund/pocket4pro style.
- The trailing `<span class="no">...</span>` shows the chapter's position —
  leave it **empty** (`<span class="no"></span>`) in any new chapter you
  write, in any tab. The sidebar numbering is computed live from the
  manifest at runtime; hardcoded `"19 / 27"`-style numbers you might see in
  older griv chapters are historical leftovers from before that became
  automatic, not something to replicate.

## Step 3: body content components

Pull these verbatim — they're the site's actual CSS hooks, not suggestions:

**Tables** — wrap every `<table>` in a `.tw` div so it gets the site's
scrollable/styled treatment:
```html
<div class="tw"><table>
<tr><th>欄位</th><th>欄位</th></tr>
<tr><td>...</td><td>...</td></tr>
</table></div>
```

**Callout boxes** — three flavors, pick by intent: `note` for neutral
context/caveats, `tip` for actionable advice or "how to decide" guidance,
`warn` for things that cause real problems if ignored.
```html
<div class="box tip">
<span class="lbl">短標籤,概括這個框在說什麼</span>
<p style="margin-bottom:0">內容...</p>
</div>
```
(Drop `style="margin-bottom:0"` from every `<p>` except the last one, if the
box has more than one paragraph.)

**End-of-chapter exercise** — every chapter ends with a `.drill` block
(labeled either "練習" for conceptual/fund chapters or "行動建議"/"出門前檢查
清單" for device chapters — match whichever framing fits):
```html
<div class="drill"><span class="lbl">練習</span>
<ol>
<li>具體、可以真的去做的一步</li>
<li>...</li>
</ol></div>
```

**Diagrams** — only add one when a picture genuinely clarifies something
words+tables don't (a spatial relationship, a comparison of two physical
things, a process with a "before/after"). Use inline SVG wrapped in
`<figure>`, with the caption doing the explaining — keep in-diagram text to
short labels, not full sentences:
```html
<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="一句話描述這張圖在示意什麼">
<rect width="640" height="210" fill="#fff"/>
<g font-family="Noto Sans TC">
  ... shapes and short <text> labels ...
</g>
</svg>
<figcaption>完整說明這張圖在講什麼,可以比圖裡的文字更長更完整。</figcaption>
</figure>
```
Site's diagram palette (reuse these, don't invent new colors): ink
`#16191B`, muted gray `#63676B`, green accent `#37C97A`, blue `#2F5F91`,
amber `#B8862C`, background `#fff`. Font is always `Noto Sans TC`.

## Step 4: citing where a claim comes from

Every factual claim that isn't common sense gets a small `<span class="src
...">` tag right after it. Four kinds exist — use the one that actually
matches where the claim comes from, don't default to one out of habit:

| Class | Meaning | Use in |
|---|---|---|
| `s-man` | Cites a specific page of RICOH's official GR IV manual (write the page number in the label, e.g. `說明書 p.42`) | griv only |
| `s-spec` | Official spec sheet or media/reviewer-reported spec (no page-numbered manual exists, e.g. DJI) | griv, pocket4pro |
| `s-gen` | Device-agnostic universal knowledge — true regardless of camera brand | fund |
| `s-mine` | This site's own synthesized advice/recommendation/opinion — explicitly *not* a vendor's claim | any tab |

```html
<p>電池出廠沒充飽,第一次使用前務必充電 <span class="src s-man">說明書 p.172</span>。</p>
```

If a paragraph makes a mix of factual and opinion claims, it's fine (and
common) to put the tag mid-sentence right after the specific clause it backs,
rather than one tag for the whole paragraph.

## Step 5: cross-linking — never write a bare "見第 N 章"

This is the one rule the repo's own history shows people get wrong: chapter
numbers displayed in the sidebar move every time a chapter gets inserted
anywhere before them. A link that points at a filename never breaks; plain
text that says "第 16 章" silently goes stale. So:

```html
<!-- Do this: -->
見<a href="#griv:16-customize.html">客製化章節</a>

<!-- Never this: -->
見第 16 章
```

The hash format is `#<tab-id>:<filename>.html` (tab ids: `fund`, `griv`,
`pocket4pro`). This works both for linking within the same tab and across
tabs (e.g. a griv chapter linking out to a fund chapter). Always use the
target chapter's actual title as the link text, not the filename or a
generic "這裡".

## Checklist: adding a new chapter end-to-end

1. Decide the tab (Step 0).
2. Pick the next unused number prefix in that tab's `chapters/` folder;
   name the file `NN-slug.html`.
3. Write the file using the template (Step 2) and components (Step 3),
   citing sources correctly (Step 4).
4. Add the filename to that tab's `manifest.json` `files` array, at the
   position matching intended reading order.
5. Add cross-links: from this chapter to any existing chapter it mentions,
   and — if this fills a gap another chapter gestured at — a short backlink
   from that existing chapter back to the new one (by filename+title, per
   Step 5). This is especially expected when a device chapter's existing
   text vaguely references a general concept that now has a real fund
   chapter to point to.
6. Bump `VERSION` in `sw.js`.
7. Sanity-check before considering it done: open the file and confirm every
   `<section>`/`<div>`/`<table>`/`<svg>` tag you added is balanced, and that
   `manifest.json` still parses as valid JSON.
