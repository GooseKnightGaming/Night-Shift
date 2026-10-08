/*
  NIGHT SHIFT — level data
  =========================
  Every level is 30 tiles wide and 17 tiles tall (one tile = 32px).
  The whole level is the inside of a building, so the outer edge is always wall.

  MAP KEY
    #   wall / floor / ceiling (solid)
    .   empty space
    H   ladder (the top ladder tile in a column is something you can stand on)
    P   player start (feet stand on the tile below)
    E   exit door (the bottom tile of the door; the door is 2 tiles tall)
    $   painting — you must take every painting before the exit unlocks
    *   bonus gem — optional and tracked on its own (shown as ◆ next to the stars)

  OBJECTS (all positions are in tiles; decimals are fine)
    camera   { x, y, angle, sweep, period, phase, fov, range, id }
             angle: 0 = right, 90 = down, 180 = left. sweep = degrees each side.
    sentry   same as camera, but heat rises much faster when it sees you
    guard    { x, from, to, y, speed }   y = the floor row the guard walks on
    drone    { path: [[x,y], [x,y], ...], speed, fov, range }
    laser    { x1, y1, x2, y2, on, off, offset, id }  on/off in seconds = pulsing
    valuable { x, y }   optional loot (cash, watches, jewellery) — take them all for the third star
    panel    { x, y, targets: [ids], duration }   hold E to hack.
             Lasers it targets switch off for good; cameras loop for `duration` seconds.

  OTHER LEVEL SETTINGS
    heat: true      being seen fills the HEAT bar instead of ending the job instantly
    shadows: [{ x, y, w, h }]   dark areas — stand fully inside one to be hidden
    reinforce: [{ heat: 66, objects: [...] }]   spawned when heat passes that value
*/

const WALL = '##############################';
const ROOM = '#............................#';

window.NIGHT_SHIFT_ACTS = [
  { name: 'Corner Gallery', levels: [0, 1, 2, 3, 4] },
  { name: 'The Museum', levels: [5, 6, 7, 8, 9] },
  { name: 'The Bank', levels: [10, 11, 12, 13, 14] },
  { name: 'The Tower', levels: [15], preview: true },
];

window.NIGHT_SHIFT_LEVELS = [
  // ───────────────────────── ACT 1: CORNER GALLERY ─────────────────────────
  {
    name: 'First Job',
    act: 0,
    hint: 'A / D to move · W or Space to jump · take the painting, then reach the door',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      '#...........$.........*......#',
      '#..........###.......###.....#',
      '#..P.......###.......###..E..#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 17, y: 15 }, { type: 'valuable', x: 6, y: 13 },
    ],
  },
  {
    name: 'Low Profile',
    act: 0,
    hint: 'Hold S to duck under low gaps and crawl through vents · jump to reach high things',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL,
      '#.........#....*......###....#',
      '#.........#...........###....#',
      '#.........#...........###....#',
      '#.P...................$...E..#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 14, y: 15 }, { type: 'valuable', x: 26, y: 13 },
    ],
  },
  {
    name: 'Lights Out',
    act: 0,
    hint: 'Light means you are seen · the dark strip under the display hides you, but only if you duck',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      ROOM,
      '#.P...........*.........$..E.#',
      WALL,
    ],
    shadows: [{ x: 10, y: 15, w: 9, h: 1 }],
    objects: [
      { type: 'valuable', x: 6, y: 15 }, { type: 'valuable', x: 21, y: 13 },
      { type: 'camera', x: 14.5, y: 12.15, angle: 90, fov: 70, range: 5 },
    ],
  },
  {
    name: 'Eye in the Sky',
    act: 0,
    hint: 'Some cameras never move · W / S on a ladder to climb · find another way round',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      '#.................*..........#',
      ROOM,
      '#.................##.........#',
      '#.............$...##.........#',
      '#####H#################H######',
      '#....H.................H.....#',
      '#....H.................H.....#',
      '#....H.................H.....#',
      '#.P..H.................H...E.#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 8, y: 10 }, { type: 'valuable', x: 26, y: 13 },
      { type: 'camera', x: 14.5, y: 12.15, angle: 90, fov: 100, range: 6 },
    ],
  },
  {
    name: 'Sweep',
    act: 0,
    hint: 'This camera sweeps · wait in the dark pockets and move when it looks away',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      '#........................$...#',
      '#.P............*...........E.#',
      WALL,
    ],
    shadows: [
      { x: 7, y: 12, w: 2, h: 4 },
      { x: 14, y: 12, w: 3, h: 4 },
      { x: 21, y: 12, w: 2, h: 4 },
    ],
    objects: [
      { type: 'valuable', x: 11, y: 15 }, { type: 'valuable', x: 19, y: 14 },
      { type: 'camera', x: 15.5, y: 12.15, angle: 90, sweep: 55, period: 4.5, fov: 34, range: 6.5 },
    ],
  },

  // ───────────────────────── ACT 2: THE MUSEUM ─────────────────────────
  {
    name: 'Night Watchman',
    act: 1,
    hint: 'Guards look the way they walk · duck in the dark and he will walk straight past you',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      ROOM,
      ROOM,
      '#.P........................E.#',
      '####H####################H####',
      '#...H....................H...#',
      '#...H....................H...#',
      '#...H..........$.........H...#',
      '#...H..............*.....H...#',
      WALL,
    ],
    shadows: [
      { x: 10, y: 12, w: 2, h: 4 },
      { x: 19, y: 12, w: 2, h: 4 },
    ],
    objects: [
      { type: 'valuable', x: 14, y: 10 }, { type: 'valuable', x: 7, y: 15 },
      { type: 'guard', x: 8, from: 8, to: 22, y: 16, speed: 1.6 },
    ],
  },
  {
    name: 'Shift Change',
    act: 1,
    hint: 'Two floors, two guards · watch their routes from above before you go down',
    map: [
      WALL,
      ROOM,
      '#.............*..............#',
      '#............###.............#',
      '#.P..........###.............#',
      '##########################H###',
      '#.........................H..#',
      '#.........................H..#',
      '#.........................H..#',
      '#.............$...........H..#',
      '#.........................H..#',
      '###H##########################',
      '#..H.........................#',
      '#..H.........................#',
      '#..H.........................#',
      '#..H.......................E.#',
      WALL,
    ],
    shadows: [
      { x: 9, y: 6, w: 2, h: 5 },
      { x: 18, y: 6, w: 2, h: 5 },
      { x: 11, y: 12, w: 2, h: 4 },
      { x: 20, y: 12, w: 2, h: 4 },
    ],
    objects: [
      { type: 'valuable', x: 20, y: 4 }, { type: 'valuable', x: 17, y: 15 },
      { type: 'guard', x: 6, from: 6, to: 23, y: 11, speed: 1.5 },
      { type: 'guard', x: 9, from: 9, to: 24, y: 16, speed: 1.7 },
    ],
  },
  {
    name: 'Double Cover',
    act: 1,
    hint: 'A guard upstairs and a camera downstairs · time the camera, then time the guard',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      ROOM,
      ROOM,
      '#.P........................E.#',
      '####H####################H####',
      '#...H....................H...#',
      '#...H....................H...#',
      '#...H....................H...#',
      '#...H..........$...*.....H...#',
      WALL,
    ],
    shadows: [
      { x: 1, y: 6, w: 5, h: 5 },
      { x: 24, y: 6, w: 4, h: 5 },
      { x: 9, y: 12, w: 2, h: 4 },
      { x: 16, y: 12, w: 2, h: 4 },
      { x: 19, y: 12, w: 2, h: 4 },
    ],
    objects: [
      { type: 'valuable', x: 12, y: 10 }, { type: 'valuable', x: 6, y: 15 },
      { type: 'guard', x: 11, from: 11, to: 18, y: 11, speed: 1.3 },
      { type: 'camera', x: 15.5, y: 12.15, angle: 90, sweep: 50, period: 6, fov: 30, range: 6 },
    ],
  },
  {
    name: 'Turning Up the Heat',
    act: 1,
    heat: true,
    hint: 'From now on, being seen fills the HEAT bar · it cools down when you stay hidden · fill it and you are caught',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      '#...................$........#',
      '#...........##.....###.......#',
      '#.P.........##.....###..*..E.#',
      WALL,
    ],
    shadows: [
      { x: 1, y: 12, w: 3, h: 4 },
      { x: 6, y: 12, w: 1, h: 4 },
      { x: 9, y: 12, w: 2, h: 4 },
      { x: 15, y: 12, w: 2, h: 4 },
      { x: 22, y: 15, w: 4, h: 1 },
    ],
    objects: [
      { type: 'valuable', x: 5, y: 13 }, { type: 'valuable', x: 17, y: 15 },
      { type: 'camera', x: 7.5, y: 12.15, angle: 90, sweep: 45, period: 3.6, fov: 32, range: 6 },
      { type: 'camera', x: 16.5, y: 12.15, angle: 90, sweep: 50, period: 4.2, phase: 1.5, fov: 32, range: 6 },
      { type: 'camera', x: 26.5, y: 12.15, angle: 120, fov: 40, range: 6 },
    ],
  },
  {
    name: 'The Collection',
    act: 1,
    heat: true,
    hint: 'Three paintings on three floors · the door stays locked until you have all of them',
    map: [
      WALL,
      ROOM,
      '#.....................*......#',
      '#...............$.....##.....#',
      '#.....................##...E.#',
      '####H#########################',
      '#...H........................#',
      '#...H........................#',
      '#...H........................#',
      '#...H.........$..............#',
      '#...H........................#',
      '#########################H####',
      '#........................H...#',
      '#........................H...#',
      '#............$...........H...#',
      '#.P......................H...#',
      WALL,
    ],
    shadows: [
      { x: 11, y: 1, w: 2, h: 4 },
      { x: 18, y: 1, w: 2, h: 4 },
      { x: 9, y: 6, w: 2, h: 5 },
      { x: 15, y: 6, w: 2, h: 5 },
      { x: 19, y: 6, w: 2, h: 5 },
      { x: 9, y: 12, w: 2, h: 4 },
      { x: 17, y: 12, w: 2, h: 4 },
    ],
    objects: [
      { type: 'valuable', x: 6, y: 4 }, { type: 'valuable', x: 24, y: 10 }, { type: 'valuable', x: 20, y: 15 },
      { type: 'guard', x: 6, from: 6, to: 21, y: 16, speed: 1.6 },
      { type: 'camera', x: 14.5, y: 6.15, angle: 90, sweep: 50, period: 4.5, fov: 34, range: 6.5 },
      { type: 'guard', x: 8, from: 7, to: 20, y: 5, speed: 1.5 },
    ],
  },

  // ───────────────────────── ACT 3: THE BANK ─────────────────────────
  {
    name: 'Tripwire',
    act: 2,
    heat: true,
    hint: 'Lasers set off the alarm · duck under high beams, jump over low ones, go round the rest',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      ROOM,
      '#.................*..........#',
      ROOM,
      '################H####H########',
      '#...............H....H.......#',
      '#...............H....H.......#',
      '#...............H....H.......#',
      '#.P.............H....H..$..E.#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 8, y: 10 }, { type: 'valuable', x: 11, y: 15 },
      { type: 'laser', x1: 7, y1: 14.6, x2: 10, y2: 14.6 },
      { type: 'laser', x1: 12.4, y1: 15.55, x2: 13.6, y2: 15.55 },
      { type: 'laser', x1: 18.5, y1: 12, x2: 18.5, y2: 16 },
    ],
  },
  {
    name: 'Pulse',
    act: 2,
    heat: true,
    hint: 'These beams switch on and off · watch the rhythm, then go',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      '#......................*.....#',
      '#.....................###....#',
      '#.P............$......###..E.#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 4, y: 13 }, { type: 'valuable', x: 16, y: 15 },
      { type: 'laser', x1: 6.5, y1: 12, x2: 6.5, y2: 16, on: 1.2, off: 1.4, offset: 0 },
      { type: 'laser', x1: 10.5, y1: 12, x2: 10.5, y2: 16, on: 1.2, off: 1.4, offset: 0.6 },
      { type: 'laser', x1: 13.5, y1: 12, x2: 13.5, y2: 16, on: 1.2, off: 1.4, offset: 1.2 },
      { type: 'laser', x1: 18.5, y1: 12, x2: 18.5, y2: 16, on: 1.0, off: 1.2, offset: 0 },
      { type: 'laser', x1: 20.5, y1: 12, x2: 20.5, y2: 16, on: 1.0, off: 1.2, offset: 1.1 },
    ],
  },
  {
    name: 'Backdoor',
    act: 2,
    heat: true,
    shadows: [
      { x: 16, y: 6, w: 2, h: 5 },
      { x: 22, y: 6, w: 2, h: 5 },
    ],
    hint: 'Stand at a hack panel and hold E · this one shuts the laser grid down for good',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      ROOM,
      ROOM,
      '#........................*...#',
      '###H##########################',
      '#..H.........................#',
      '#..H.........................#',
      '#..H.........................#',
      '#P.H....................$..E.#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 13, y: 10 }, { type: 'valuable', x: 6, y: 15 },
      { type: 'panel', x: 8, y: 10, targets: ['grid'] },
      { type: 'laser', id: 'grid', x1: 12.5, y1: 12, x2: 12.5, y2: 16 },
      { type: 'laser', id: 'grid', x1: 14.5, y1: 12, x2: 14.5, y2: 16 },
      { type: 'laser', id: 'grid', x1: 16.5, y1: 12, x2: 16.5, y2: 16 },
      { type: 'laser', id: 'grid', x1: 18.5, y1: 12, x2: 18.5, y2: 16 },
      { type: 'laser', id: 'grid', x1: 20.5, y1: 12, x2: 20.5, y2: 16 },
      { type: 'camera', x: 16.5, y: 6.15, angle: 90, sweep: 55, period: 4, fov: 34, range: 6.5 },
    ],
  },
  {
    name: 'Blind Spot',
    act: 2,
    heat: true,
    shadows: [
      { x: 22, y: 12, w: 2, h: 4 },
      { x: 26, y: 12, w: 1, h: 4 },
    ],
    hint: 'Hack the panel to loop the big camera for a few seconds · then run',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      '#..............$.............#',
      '#.P.....................*..E.#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 4, y: 13 }, { type: 'valuable', x: 20, y: 15 },
      { type: 'panel', x: 6, y: 15, targets: ['cam'], duration: 6 },
      { type: 'camera', id: 'cam', x: 15.5, y: 12.15, angle: 90, fov: 110, range: 6 },
      { type: 'camera', x: 25.5, y: 12.15, angle: 90, sweep: 35, period: 5.5, fov: 26, range: 6 },
    ],
  },
  {
    name: 'The Vault',
    act: 2,
    heat: true,
    hint: 'Everything at once · the vault panel is upstairs',
    map: [
      WALL,
      ROOM,
      ROOM,
      ROOM,
      '#.P..........................#',
      '##########################H###',
      '#.........................H..#',
      '#.........................H..#',
      '#.........................H..#',
      '#...........$.............H..#',
      '#.........................H..#',
      '###H##########################',
      '#..H.........*...............#',
      '#..H.........................#',
      '#..H.........................#',
      '#..H.........$.............E.#',
      WALL,
    ],
    shadows: [
      { x: 7, y: 1, w: 2, h: 4 },
      { x: 12, y: 1, w: 2, h: 4 },
      { x: 17, y: 1, w: 2, h: 4 },
      { x: 9, y: 6, w: 2, h: 5 },
      { x: 16, y: 6, w: 2, h: 5 },
    ],
    objects: [
      { type: 'valuable', x: 24, y: 4 }, { type: 'valuable', x: 20, y: 10 }, { type: 'valuable', x: 24, y: 15 },
      { type: 'camera', x: 12.5, y: 1.15, angle: 90, sweep: 55, period: 4, fov: 34, range: 5.5 },
      { type: 'panel', x: 20, y: 4, targets: ['vault'] },
      { type: 'guard', x: 6, from: 6, to: 22, y: 11, speed: 1.7 },
      { type: 'laser', id: 'vault', x1: 8.5, y1: 12, x2: 8.5, y2: 16 },
      { type: 'laser', id: 'vault', x1: 17.5, y1: 12, x2: 17.5, y2: 16 },
      { type: 'laser', x1: 22.5, y1: 12, x2: 22.5, y2: 16, on: 1.2, off: 1.2 },
    ],
  },

  // ───────────────────────── ACT 4: THE TOWER (preview) ─────────────────────────
  {
    name: 'Hover',
    act: 3,
    heat: true,
    hint: 'Drones fly over walls and floors · stay under cover · if the heat gets high, more arrive',
    map: [
      WALL, WALL, WALL, WALL, WALL, WALL,
      ROOM,
      ROOM,
      ROOM,
      ROOM,
      ROOM,
      '#.....#####......#####.......#',
      ROOM,
      ROOM,
      '#.......................$....#',
      '#.P.....*..................E.#',
      WALL,
    ],
    objects: [
      { type: 'valuable', x: 19, y: 15 }, { type: 'valuable', x: 14, y: 13 },
      { type: 'drone', path: [[26, 7.5], [3, 7.5]], speed: 2.4, fov: 56, range: 9 },
    ],
    reinforce: [
      { heat: 66, objects: [{ type: 'drone', path: [[26, 9], [3, 9]], speed: 3, fov: 50, range: 8 }] },
    ],
  },
];
