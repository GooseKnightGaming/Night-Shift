# Night Shift

A 2.5D stealth platformer by GooseKnightGaming. Get in, take the painting, get out without being seen.

Current version: **V3**. You move side-on (2D rules), but the picture is 3D, drawn with Three.js (loaded from a CDN). No build step.

## Play locally
Open `index.html` in a browser. To unlock every level for testing, open `index.html#all`.

## Put it on GitHub Pages
1. Create a repository and upload `index.html`, `style.css`, `levels.js`, `render3d.js` and `game.js`.
2. In the repository, go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.
3. The game appears at `https://<your-username>.github.io/<repository-name>/` after a minute or two.

## Controls
| Key | Action |
| --- | --- |
| A / D (or arrows) | Move |
| W / Space | Jump · W and S climb ladders |
| S (or Ctrl) | Duck and crawl |
| E | Hack a panel (hold) · leave through the exit door |
| Q | Throw a decoy |
| R | Restart level |
| Esc / P | Pause |

## Files
- `levels.js` — every level as a text map plus a list of security objects. The key at the top of the file explains each symbol. This is the file to edit to make new levels.
- `game.js` — the engine: movement, ladders, vision cones, heat, lasers, panels, menus, saving and the HUD.
- `render3d.js` — the 3D view: building, thief and guard models, cameras, drones, lasers, loot and lighting.
- `style.css` — menus and page layout.

## How detection works
- Cameras, guards, drones and sentries each have a vision cone. Walls block it.
- Shadows hide you only when your whole body is inside one (ducking helps you fit).
- Guards see where their torch points.
- Being seen fills the **heat** bar. At 33% security goes on alert, at 66% it's lockdown, at 100% you're caught. Heat cools off when you stay hidden.

## Stars and the gem
1. Escape. 2. Never get spotted. 3. Take every valuable (cash, watches, jewellery).

The bonus gem ◆ is tracked separately, so you can get three stars without it, or the gem without three stars.
Every level has been checked automatically so that every painting, valuable, gem and the exit can be reached without being seen.

## Money and the Safehouse
Every painting, valuable and gem has a value. It pays into your bank the first time you escape with it (replays only pay for things you hadn't taken before).
Spend the bank at the Safehouse: Quick Fingers (faster hacking), Loop Extender (longer camera loops), Cool Head (heat cools sooner), Dark Clothing (heat builds slower) and Decoys (press Q to throw; guards on that floor go and stare at it).

## Status
Acts 1–3 (15 levels) are playable, plus a preview of Act 4. The engine already supports drones, sentries and heat-triggered reinforcements for the rest of Act 4.

## Changelog
**V3**
- Lower jump (about 1.5 tiles). Crates are now 1 tile tall and high loot moved within reach.
- The exit needs E, so loot near or past the door can be collected first.
- Guards' vision now comes from the torch in their hand.
- Heat bar on every level (no more instant fail in the early levels).
- Level 11's low laser is shorter and lower, so it can actually be jumped.
- Cash: every item has a value, banked when you escape. Safehouse shop with four upgrades and throwable decoys.

**V2**
- 2.5D: 3D models, lighting and camera with the same side-on gameplay.
- Bonus gem tracked separately from stars. Third star is now for optional valuables.
- Heavier gravity and a lower, quicker jump.
- Level 8 rebalanced (shorter guard route, hiding spots by both ladders, slower camera).
- Added hiding spots where a camera made "never spotted" impossible (Levels 8, 9, 10, 13, 14, 15).
- Version number shown on the title screen and HUD.

**V1**
- First playable: 15 levels across Acts 1–3, plus an Act 4 preview.
