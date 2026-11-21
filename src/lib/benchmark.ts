// A fixed set of challenges, each run several times, so every model faces the same tasks.
// Each challenge states what "working" means in checkable terms, so the testers and the
// judge check the same things. Tools and toys avoid game words ("score", "level"), which
// would make the browser test expect them to react to the arrow keys.

export type BenchmarkCategory = "Games" | "Tools" | "Toys" | "Twists";

export type BenchmarkChallenge = {
  id: string;
  category: BenchmarkCategory;
  title: string;
  /** Exactly what the gladiators are given. */
  challenge: string;
};

/** How many times each challenge is run. Only the first this-many valid runs count. */
export const BENCHMARK_RUNS = 3;

/** Battles before this were played under different rules and don't count. */
export const BENCHMARK_FROM = "2026-11-21T10:50:00Z";

/** Battles spoiled by the arena rather than a model. They're re-run, and kept out of the results. */
export const BENCHMARK_VOID: Record<string, string> = {
  "2026-11-21-5773156b": "HTML extraction bug discarded a complete entry",
  "2026-11-21-863cff6f": "HTML extraction bug discarded a complete entry",
  "2026-11-21-847977ad": "HTML extraction bug discarded a complete entry",
  "2026-11-21-091a8fa0": "HTML extraction bug discarded a complete entry",
  "2026-11-21-e23e2f33": "HTML extraction bug discarded a complete entry",
};

export const BENCHMARK: BenchmarkChallenge[] = [
  {
    id: "snake",
    category: "Games",
    title: "Snake",
    challenge:
      "Snake game. Arrow keys steer. Eating food grows the snake by one and adds a point to the score. Hitting a wall or the snake's own body ends the game and shows a Restart button that starts a new game.",
  },
  {
    id: "blocks",
    category: "Games",
    title: "Falling blocks",
    challenge:
      "Falling-block puzzle game. Left and Right move the piece, Up rotates it, Down drops it faster. Full rows disappear and add to the score. The game ends when a new piece can't fit, with a way to play again.",
  },
  {
    id: "flap",
    category: "Games",
    title: "One-button flyer",
    challenge:
      "One-button game. A bird falls under gravity and flaps up when you press Space or click. Gaps in walls scroll towards it, and each gap passed adds a point to the score. Touching a wall or the ground ends the game and shows Restart.",
  },
  {
    id: "calculator",
    category: "Tools",
    title: "Calculator",
    challenge:
      "Calculator with on-screen buttons that also works from the keyboard. It must follow operator precedence (2 + 3 × 4 = 14), add decimals correctly (0.1 + 0.2 = 0.3), show an error for division by zero, and have a Clear button.",
  },
  {
    id: "bill",
    category: "Tools",
    title: "Bill splitter",
    challenge:
      "Bill splitter. Inputs for the bill, the tip percentage and the number of people. Show the tip, the total and each person's share in pounds to 2 decimal places, updating as you type. A £50 bill with a 10% tip split 2 ways is £27.50 each.",
  },
  {
    id: "todo",
    category: "Tools",
    title: "To-do list",
    challenge:
      "To-do list. Add a task by typing and pressing Enter, tick tasks off, delete them, filter by All, Active and Done, and show how many tasks are left. Empty tasks can't be added.",
  },
  {
    id: "converter",
    category: "Tools",
    title: "Unit converter",
    challenge:
      "Unit converter for length, weight and temperature. Pick the units from dropdowns and type a value; the result updates instantly. 100 °C must give 212 °F, 1 mile 1.609 km and 1 kg 2.205 lb. Include a button to swap the two units.",
  },
  {
    id: "drawing",
    category: "Toys",
    title: "Drawing pad",
    challenge:
      "Drawing pad. Draw on a canvas by dragging the mouse. Choose from at least 5 colours and 3 brush sizes. Undo removes the last stroke, Clear empties the canvas, and the current colour and size are always shown.",
  },
  {
    id: "clock",
    category: "Toys",
    title: "Analogue clock",
    challenge:
      "Analogue clock showing the current local time, with hour, minute and second hands that move in real time, the numbers 1 to 12 around the face, and a digital readout underneath that always agrees with the hands.",
  },
  {
    id: "memory",
    category: "Toys",
    title: "Memory cards",
    challenge:
      "Memory cards. 16 face-down cards in 8 matching pairs. Click two cards to flip them: a pair stays face up, otherwise both turn back after a second. Count the moves, and show a message with the move count when every pair is found.",
  },
  {
    id: "bricks",
    category: "Twists",
    title: "Bricks fight back",
    challenge: "Breakout where the bricks fight back",
  },
  {
    id: "cat",
    category: "Twists",
    title: "Judgemental cat",
    challenge: "A cat that follows your cursor and judges your life choices",
  },
];

export const BENCHMARK_CATEGORIES: BenchmarkCategory[] = ["Games", "Tools", "Toys", "Twists"];

const normalise = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const byChallenge = new Map(BENCHMARK.map((b) => [normalise(b.challenge), b]));

/** The benchmark challenge with this exact wording (ignoring spacing and case), if any. */
export const benchmarkOf = (challenge?: string) => (challenge ? byChallenge.get(normalise(challenge)) : undefined);
