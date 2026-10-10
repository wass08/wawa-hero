// Tunable thresholds for pose classification, judging and energy. Tweak live with /pose-debug.html.
// All distances are in "body units" = shoulder widths (scale-invariant), angles in degrees unless noted.

export const MOVES = ['up', 'down', 'clap', 'split_lu', 'split_ld', 'sweep'];
export const TAP_MOVES = ['up', 'down', 'clap', 'split_lu', 'split_ld'];
export const SCORE_KEYS = ['up', 'down', 'clap', 'split_lu', 'split_ld', 'overhead', 'low'];

// KeyboardEvent.code → move (keys 1..6, plus arrows/space as in SPEC).
// P1 keyboard map (KeyboardEvent.code → move).
export const MOVE_KEYS = {
  Digit1: 'up', Digit2: 'down', Digit3: 'clap', Digit4: 'split_lu', Digit5: 'split_ld', Digit6: 'sweep',
  Numpad1: 'up', Numpad2: 'down', Numpad3: 'clap', Numpad4: 'split_lu', Numpad5: 'split_ld', Numpad6: 'sweep',
  ArrowUp: 'up', ArrowDown: 'down', Space: 'clap',
};

// P2 keyboard map: 7 8 9 0 - = → up, down, clap, split_lu, split_ld, sweep.
export const MOVE_KEYS_P2 = {
  Digit7: 'up', Digit8: 'down', Digit9: 'clap', Digit0: 'split_lu', Minus: 'split_ld', Equal: 'sweep',
};

// Combined map: KeyboardEvent.code → { player: 0|1, move }.
export const PLAYER_KEYS = Object.freeze(Object.fromEntries([
  ...Object.entries(MOVE_KEYS).map(([k, move]) => [k, Object.freeze({ player: 0, move })]),
  ...Object.entries(MOVE_KEYS_P2).map(([k, move]) => [k, Object.freeze({ player: 1, move })]),
]));

export const POSE_CONFIG = {
  // --- visibility gating (MediaPipe visibility 0..1) ---
  visLo: 0.3,             // arm gate starts rising
  visHi: 0.6,             // arm gate fully open
  presentVis: 0.5,        // landmark counts as "visible" for upperBody/fullBody and hip usage
  frameMargin: 0.08,      // landmarks this far outside [0,1] are treated as not visible

  // --- goal-post moves (up / down / split_*) — round 4: loosened, protected by the elbow-bend band ---
  // (round 1–3 values: |upper arm elev| 22/45 symmetric, forearm 25/50 up and down, no bend band)
  upperRaiseFull: 25,     // upper arm raised ABOVE horizontal: full up to 25°…
  upperRaiseZero: 45,     //   …0 at 45° (V arms / overhead fail here)
  upperDropFull: 32,      // upper arm DROPPED below horizontal (elbow under the shoulder line): full to 32°…
  upperDropZero: 52,      //   …0 at 52° (hanging / clap / akimbo upper arms fail here)
  forearmUpFull: 30,      // "up" forearm leaning OUTWARD: full to 30°…
  forearmUpZero: 55,      //   …0 at 55°
  forearmUpInFull: 22,    // "up" forearm leaning INWARD (towards the head): full to 22°…
  forearmUpInZero: 42,    //   …0 at 42° (hands on / behind the head fail here)
  forearmDownOutFull: 35, // "down" forearm drifting OUTWARD (common): full to 35°…
  forearmDownOutZero: 60, //   …0 at 60°
  forearmDownInFull: 25,  // "down" forearm leaning INWARD (towards hips): full to 25°…
  forearmDownInZero: 45,  //   …0 at 45° (akimbo / hands-on-hips fail here)
  bendMinZero: 35,        // elbow interior angle band: 0 below 35°, 1 from 50°…
  bendMinFull: 50,
  bendMaxFull: 150,       //   …1 up to 150°, 0 at 168° (straight arms never form a goal post)
  bendMaxZero: 168,
  armOn: 0.5,             // per-arm goal-post state arrival (coincidence lead) hysteresis…
  armOff: 0.3,
  coincidenceMs: 150,     // both arms within this of each other → onset back-dated to the first arm
  segLenLo: 0.3,          // projected segment length (body units) gate: foreshortened (pointing at camera) segments
  segLenHi: 0.5,          //   are unreliable, so their angles are faded out

  // --- straightness (informational; not required by any move) ---
  elbowBent: 125,         // interior elbow angle → elbowStraight 0
  elbowStraight: 160,     // interior elbow angle → elbowStraight 1

  // --- HIGH / LOW from the UPPER ARM only (shoulder→elbow; wrists may be out of frame) ---
  // angles in deg from torso-down on the arm's own side (0 hanging, 90 T, 180 straight up)
  highZero: 112,          // scores.overhead per arm: 0 below 112°…
  highFull: 132,          //   …1 above 132° (≈ 2.3 rad; SPEC: high ≥ ~2.2 rad)
  highPastFull: 215,      // slightly past vertical (upper arm leaning inward over the head) still counts…
  highPastZero: 235,      //   …until 235° (= 55° past vertical across the head)
  lowFull: 30,            // scores.low per arm: |upper arm angle| ≤ 30° → 1
  lowZero: 50,

  // --- clap ---
  clapDistFull: 0.45,     // wrist distance (shoulder widths) → 1 below this
  clapDistZero: 0.75,     //   → 0 above this (SPEC: < ~0.6)
  clapCrossFull: 0.12,    // left wrist past right wrist (screen x) by this much is still OK…
  clapCrossZero: 0.35,    //   …crossed arms (X in front of chest) fade out here
  clapCenterFull: 0.5,    // |midpoint of wrists − body centre| horizontally
  clapCenterZero: 0.9,
  clapHighZero: -0.9,     // wrist midpoint height relative to shoulder line (negative = above, y down)
  clapHighFull: -0.6,     //   allows clapping in front of the face [round 1–3: −1.3 / −0.9]
  clapElbowZero: -0.2,    // round 4: elbows must not be raised above the shoulder line (lowest elbow y)…
  clapElbowFull: 0.05,    //   …rejects hands behind / on the head
  clapLowFull: 1.15,      // hips are ~1.5 below; hands resting clasped at the belly/hips are rejected
  clapLowZero: 1.4,

  torsoToShoulder: 1.7,   // torso length / shoulder width; used to keep the scale sane when the player turns

  // --- landmark smoothing (One-Euro on normalized coords) ---
  filter: { minCutoff: 2.0, beta: 8.0, dCutoff: 1.0 },
  lostResetMs: 300,       // reset filters/energy history after tracking is lost this long

  // --- energy (movement intensity) ---
  energy: {
    joints: [13, 14, 15, 16, 23, 24], // elbows, wrists, hips
    speedLo: 0.4,         // mean joint speed (shoulder widths / s) mapped to energy 0 (sensor noise / fidgeting)
    speedHi: 4.4,         //   → energy 1 (vigorous); ~2.4 sw/s (a move every beat at 120 bpm) → 0.5
    tau: 0.5,             // EMA time constant (s) on speed
    maxDt: 0.25,          // ignore speed across gaps longer than this (s)
  },

  // --- two-player identity (players.js) ---
  players: {
    trackMs: 500,         // a slot seen within this is "tracked" and claims its nearest detection first
    staleMs: 4000,        // a slot's last x is remembered this long for re-entry, then default 0.25 / 0.75
    swapMargin: 0.02,     // near-tie (cost units ≈ mirrored x) → keep the slots' current left/right order
    memoryAlpha: 0.5,     // EMA factor of the slot signature (x, y, shoulder span) while tracked
    dupDist: 0.03,        // two detections closer than this (centroid x) are the same person
  },

  // --- judging ---
  judge: {
    on: 0.6,              // score rising above → move active (onset)
    off: 0.4,             // score falling below → move released (hysteresis)
    onByMove: { split_lu: 0.5, split_ld: 0.5 },  // round 4: splits onset at 0.5 (was 0.6)…
    offByMove: { split_lu: 0.3, split_ld: 0.3 }, //   …release at 0.3 (was 0.4)
    maxLead: 0.15,        // s: cap on frame.onsetLead back-dating
    // s: a goal-post activation must stay up this long before its onset counts (onset time = start of
    // the dwell, so timing is unaffected) — filters up↔down flip transients that pass through a split
    dwellByMove: { up: 0.06, down: 0.06, split_lu: 0.06, split_ld: 0.06 },
    // Phase-based sweep (SPEC round 3): HIGH → T → LOW on the player's own side, upper arms only.
    sweep: {
      defaultDur: 1.5,
      // round 4 (forgiving) — previous values in brackets
      visMin: 0.5,        // per-arm: elbowVis ≥ this → arm usable (one usable arm is enough) [both arms]
      inferMin: 1.4,      // rad (80°): elbow lost at the top while last seen ≥ this and rising → inferred high
      highMin: 1.9,       // rad (≈ 109°): usable arms ≥ this = HIGH [2.2]
      highMax: 3.9,       // rad (≈ 223°): beyond this the arm is well across the head → not HIGH
      earlyHigh: 0.35,    // s: HIGH may be reached this long before the good window opens [0]
      tAngle: Math.PI / 2,// T crossing angle (perfect vs good only) [was also required for LOW]
      maxInterpGap: 0.25, // s: T crossing is interpolated between readings at most this far apart
      lowMax: 0.85,       // rad (≈ 49°): usable arms |upper arm| ≤ this = LOW [0.6]
      minLowAfter: 0,     // LOW before t + minLowAfter·dur (i.e. before the cue) → reset, needs a new HIGH
      acrossMin: 0.6,     // rad: a visible upper arm at signed angle in [−acrossMax, −acrossMin] is across…
      acrossMax: 2.5,
      acrossFrames: 3,    //   …for this many frames after HIGH → wrong direction → miss [2]
      phaseGrace: 0.7,    // s after t+dur in which LOW still counts (as 'good') [0.4]
      lowOnTimeTol: 0.05, // s of slack on "LOW by t+dur" for perfect (frame quantisation)
      tWindow: 0.25,      // perfect: T crossing within ±tWindow·dur of t + dur/2
      progressFrom: 2.6,  // rad: progress = descent fraction from this mean upper-arm angle…
      progressTo: 0.85,   //   …to this one (= lowMax; monotonic)
      synthStartDeg: 165, // synthetic (keyboard/bot) held sweep: straight arms from 165°…
      synthEndDeg: 10,    //   …to 10° linearly over dur (T crossing ≈ mid, LOW at ≈ 85 %)
    },
  },
};
