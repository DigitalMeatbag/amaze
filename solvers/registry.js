import { DFS } from "./dfs.js";
import { BFS } from "./bfs.js";
import { AStar } from "./astar.js";
import { Greedy } from "./greedy.js";
import { WallFollower } from "./wallfollower.js";
import { RandomWalk } from "./randomwalk.js";

export const Solvers = {
  dfs: DFS,
  bfs: BFS,
  astar: AStar,
  greedy: Greedy,
  wallfollower: WallFollower,
  randomwalk: RandomWalk,
};

export const SOLVER_COLORS = {
  dfs:          { breadcrumb: "#FF5533", path: "#FF7755" },
  bfs:          { breadcrumb: "#33CCFF", path: "#66DDFF" },
  astar:        { breadcrumb: "#33FF66", path: "#66FF99" },
  greedy:       { breadcrumb: "#FFCC33", path: "#FFE066" },
  wallfollower: { breadcrumb: "#CC66FF", path: "#DD99FF" },
  randomwalk:   { breadcrumb: "#AAAAAA", path: "#CCCCCC" },
};

export const SOLVER_LABELS = {
  dfs:          "DFS",
  bfs:          "BFS",
  astar:        "A*",
  greedy:       "Greedy",
  wallfollower: "Wall Follower",
  randomwalk:   "Random Walk",
};

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

export function selectSolvers(rng = Math.random) {
  const pool = ["dfs", "bfs", "astar", "greedy", "wallfollower", "randomwalk"];
  shuffle(pool, rng);
  return pool.slice(0, 4);
}

export function makeSolver(key) {
  const Cls = Solvers[key];
  if (!Cls) throw new Error("Unknown solver: " + key);
  return new Cls();
}
