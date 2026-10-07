# Periodic-table brand: plan

> **Status: proposal for later, nothing applied.** This document records a branding idea. It changes no icon,
> logo, colour token, package name or command, and nothing in the app reads it.
>
> **Audience:** internal planning. **Written:** 2026-10-07, after an exploration across a small family of products.

## The idea

Brand each product as a tile from the periodic table.

- **Symbol:** the first one or two letters of the product name, written like an element symbol (`K`, `Kl`).
- **Number:** an atomic number.
- **Tile:** the number small at the top left, the symbol large, the product name under it, and a two-word
  descriptor at the bottom.

Product names stay as they are. The tile becomes the mark, and can optionally sit beside the name.

A tile is **real** when the symbol is an element and the number is its atomic number (`K·19`, potassium). It is
**synthetic** when the symbol is not an element (`Kl`) or the number is past 118, the last
element on the real table.

## Klose (this repo)

**What it is.** A local, no-login design canvas that lives inside a coding agent. It installs as a `/klose` skill,
an npm CLI (`klose`) and a menu-bar app. Public repo, v0.2.1, AGPL-3.0.

**Today.** The app icon is a white disc with a blue halo on a navy rounded square
(`apps/desktop/icons/app-icon.png`, copied into `apps/desktop/src-tauri/icons/`). Inside the app the logo is a plain
dot beside the word "Klose" (near-white in the dark UI, dark navy in the light UI), drawn in CSS in
`components/Layout/Navbar.tsx`, `pages/WelcomePage.tsx` and `pages/LandingPage.tsx`. Palette: navy `#0B1220`,
disc `#F8FAFC`, accent `#3B82F6` in the dark UI and `#2563EB` in the light UI (`index.html`). `index.html` sets a
page title and no favicon link.

### Candidate tiles

| Tile | Source | Status | Why |
|---|---|---|---|
| **`K·19`** (recommended) | Product name | Real: potassium | One letter is the boldest mark available, and K is the letter that makes Klose look like Klose. |
| **`O·8`** | Repo name (OpenKlose) | Real: oxygen | Real, but `O·8` is already the number on a sibling product's logo. |
| **`Kl·4`** | Native number | Synthetic: 4 is beryllium (Be) | The loop has four steps: sketch, preview, comment, build. |
| **`Kl·3`** | By age | Synthetic: 3 is lithium (Li) | The third repo created. The number never changes. |
| **`Kl·121`** | Period 8 | Synthetic: past 118, the last element | 118 plus 3. A new element past oganesson. |

**Working selection:** `K·19`, the same as the recommendation.

**Rename risk: high.** `/klose` is the skill command, `klose` is the npm package and CLI (`bin/klose.js`), and the
installers are named `Klose-mac-apple-silicon.dmg`, `Klose-mac-intel.dmg` and `Klose-windows-setup.exe`. User repos
hold a `.klose/` folder. Use the tile as the mark or beside the name, not as a new name.

**Notes**

- `Kl` reads like `KI` in most sans-serif faces. A single `K` avoids that.
- If a story is wanted: potassium is the soft metal that reacts the moment it touches water, and Klose reacts to
  your design system the same way.
- Icon idea, for later: keep the navy square, the white disc and the halo, put the `K` inside the disc and the
  number small at the top left in blue.

### If this is applied later (not part of this change)

- **Swap:** `apps/desktop/icons/app-icon.png` and `apps/desktop/src-tauri/icons/` (`icon.png`, `icon.ico`,
  `icon.icns`); the dot in `components/Layout/Navbar.tsx`, `pages/WelcomePage.tsx` and
  `pages/LandingPage.tsx`; the README header and download badges; `docs/images/hero.png`, a screenshot of the
  landing page. `index.html` has no favicon today, so a tile favicon would be new.
- **Leave alone:** the `/klose` skill and the files under `skills/`; the `klose` npm package name and
  `bin/klose.js`; the installer file names used by `.github/workflows/release-app.yml` and the README; the `.klose/`
  folder written into user repos.

## Numbering rules

Five ways to choose the number, shown for Klose.

| Rule | How the number is chosen | Klose |
|---|---|---|
| **A. Real elements** | Letters from the product name, number from the real table. | `K·19` |
| **B. Repo elements** | Letters from the repo name (OpenKlose). | `O·8` |
| **C. Native numbers** | A fact about the product: the loop has four steps. | `Kl·4` |
| **D. By age** | The order the repos in the product family were created. Klose is third of four. | `Kl·3` |
| **E. Period 8** | 118 plus the age order: numbers past oganesson. | `Kl·121` |

- **A.** Real potassium, and the number cannot drift.
- **B.** Real oxygen, but `O·8` is already claimed by a sibling product's logo.
- **C.** Every number has a story, but facts can drift.
- **D.** Simple and stable, but the number says nothing about the product.
- **E.** Nothing real to clash with, but it gives up the real-element wink.

## Recommendation

**`K·19`.** Keep the name Klose and use the tile as the mark.

- Potassium is a real element, so the number is fixed by the periodic table and cannot drift.
- One letter is the boldest mark available, and K is the letter that makes Klose look like Klose.
- Do not use the code as the product name. `K19` collides with a well-known submarine and film, and the name `klose`
  is already the skill command, the npm package and the installer prefix.

## Working selection

The exploration saved `K·19` on 2026-10-07, with an outline look, the product's own display face and a lockup (tile
beside the name). It was **not locked in**, so treat it as a working state, not a decision.

## Treatment options

| Choice | Options |
|---|---|
| Look | **Outline:** brand-colour border on the page surface. **Filled:** a brand-colour tile, like the cells of the real table. **Mono:** one ink, for print and stamps. |
| Letters | One typeface for every symbol (Manrope), or the product's own display face (Inter for Klose). |
| Naming | **Mark only:** the tile is the logo and names are unchanged. **Lockup:** the tile sits beside the name. **Code name:** the code becomes the name (`K·19`) and the old name drops to a descriptor. |

Size rules used in the exploration: the descriptor drops below about 150 px, the name below about 90 px, and the
number below about 50 px, leaving the symbol alone. App icons keep the number down to about 44 px and show the
symbol only below that.

## Tile colours and contrast

Filled-tile colours, taken from Klose's existing palette. Contrast is WCAG relative luminance for symbol / number /
descriptor on the fill. Large text needs 3:1 and small text needs 4.5:1.

| Product | Fill | Symbol | Number | Descriptor | Contrast |
|---|---|---|---|---|---|
| Klose | `#0B1220` | `#FFFFFF` | `#60A5FA` | `#A9B6CC` | 18.7 / 7.4 / 9.1 |

## Open decisions

1. **Letters from the product name or the repo name?** The product name gives `K` (recommended). The repo name gives
   `O`, which is already taken by a sibling product.
2. **How far does the rename go?** Mark only, lockup or code name. For Klose, mark or lockup. A code name would touch
   the `/klose` command, the npm package and the installers.

## How this was derived

- Product facts from this repo's README, `package.json` and the brand files named in its section.
- Colours sampled from the existing icons and read from the files named in the product section.
- Element names follow IUPAC spelling. Symbols and numbers were checked against all 118 elements.
- Contrast uses WCAG relative luminance.
- The tiles were mocked up in a throwaway HTML page that is not part of the repo. The numbers in this file are the
  source of truth.

## Not in this change

- No icon, logo, favicon, app icon or splash file.
- No colour token, font or CSS change.
- No package, command, URL, cookie or storage-key rename.
- No code reads this file.
