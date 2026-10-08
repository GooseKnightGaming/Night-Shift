# Night Shift

A small 2D stealth platformer by GooseKnightGaming. Get in, take the painting, get out without being seen.

Plain HTML, CSS and JavaScript with one `<canvas>`. No libraries, no build step.

## Play locally
Open `index.html` in a browser. To unlock every level for testing, open `index.html#all`.

## Put it on GitHub Pages
1. Create a repository and upload `index.html`, `style.css`, `levels.js` and `game.js`.
2. In the repository, go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.
3. The game appears at `https://<your-username>.github.io/<repository-name>/` after a minute or two.

## Controls
| Key | Action |
| --- | --- |
| A / D (or arrows) | Move |
| W / Space | Jump · W and S climb ladders |
| S (or Ctrl) | Duck and crawl |
| E (hold) | Hack a panel |
| R | Restart level |
| Esc / P | Pause |

## Files
- `levels.js` — every level as a text map plus a list of security objects. The key at the top of the file explains each symbol. This is the file to edit to make new levels.
- `game.js` — the engine: movement, ladders, vision cones, heat, lasers, panels, menus and saving.
- `style.css` — menus and page layout.

## How detection works
- Cameras, guards, drones and sentries each have a vision cone. Walls block it.
- Shadows hide you only when your whole body is inside one (ducking helps you fit).
- Levels 1–8: being seen for a split second gets you caught.
- Level 9 onwards: being seen fills the **heat** bar. At 33% security goes on alert, at 66% it's lockdown, at 100% you're caught. Heat cools off when you stay hidden.

## Stars
1. Escape. 2. Never get spotted. 3. Take everything, including the bonus gem.

## Status
Acts 1–3 (15 levels) are playable, plus a preview of Act 4. The engine already supports drones, sentries and heat-triggered reinforcements for the rest of Act 4.
