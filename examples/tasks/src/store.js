/**
 * File-backed task store. Persisted to ../tasks.json next to serve.mjs.
 *
 * Vite's client build statically resolves every import. To keep node:*
 * imports out of the client bundle (this module is only ever called from
 * load() blocks during SSR), each helper does a dynamic import inside its
 * body. The .jslop routes import this file dynamically with @vite-ignore so
 * Rollup doesn't follow the edge into it for the browser.
 */

export const STATUSES = ["todo", "doing", "done"];
export const PRIORITIES = ["low", "med", "high"];

async function resolveDataPath() {
  // Resolve against the project root (process.cwd) so both the unbundled
  // serve.mjs import path and the SSR-bundled chunk path land on the same
  // file. Allow override via TASKS_DATA env for tests / deployments.
  const { resolve } = await import("node:path");
  return resolve(process.env.TASKS_DATA ?? process.cwd(), "tasks.json");
}

async function readAll() {
  const { readFile } = await import("node:fs/promises");
  const dataPath = await resolveDataPath();
  try {
    const txt = await readFile(dataPath, "utf8");
    const parsed = JSON.parse(txt);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(tasks) {
  const { writeFile } = await import("node:fs/promises");
  const dataPath = await resolveDataPath();
  await writeFile(dataPath, JSON.stringify(tasks, null, 2) + "\n", "utf8");
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export async function listTasks() {
  const all = await readAll();
  // Newest first; falls back to id sort if createdAt missing on legacy rows.
  return [...all].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getTask(id) {
  const all = await readAll();
  return all.find((t) => t.id === id) ?? null;
}

export async function createTask({ title, priority = "med" }) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) throw new Error("title required");
  if (!PRIORITIES.includes(priority)) throw new Error("invalid priority");
  const all = await readAll();
  const task = {
    id: newId(),
    title: trimmed,
    status: "todo",
    priority,
    createdAt: Date.now(),
  };
  all.push(task);
  await writeAll(all);
  return task;
}

export async function updateTask(id, patch) {
  const all = await readAll();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const current = all[idx];
  const next = { ...current };
  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    if (!t) throw new Error("title cannot be empty");
    next.title = t;
  }
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new Error("invalid status");
    next.status = patch.status;
  }
  if (patch.priority !== undefined) {
    if (!PRIORITIES.includes(patch.priority)) throw new Error("invalid priority");
    next.priority = patch.priority;
  }
  all[idx] = next;
  await writeAll(all);
  return next;
}

export async function deleteTask(id) {
  const all = await readAll();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await writeAll(all);
  return true;
}

/** Cycle todo → doing → done → todo. */
export function nextStatus(s) {
  const i = STATUSES.indexOf(s);
  return STATUSES[(i + 1) % STATUSES.length];
}
