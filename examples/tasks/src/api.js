/**
 * Client-side mutation helpers. Every call posts to the REST API exposed by
 * serve.mjs and, on success, re-navigates to the current URL so the route's
 * load() refetches and the page updates. This is the simplest possible
 * mutation story; an `action { }` block on the framework side would let
 * components declare server mutations inline.
 */
import { navigate } from "@jslop/client";

async function mutate(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : await res.json();
}

export async function createTask(title, priority) {
  await mutate("POST", "/api/tasks", { title, priority });
  await navigate(window.location.pathname + window.location.search);
}

export async function updateTask(id, patch) {
  await mutate("PATCH", `/api/tasks/${id}`, patch);
  await navigate(window.location.pathname + window.location.search);
}

export async function deleteTask(id, redirectTo) {
  await mutate("DELETE", `/api/tasks/${id}`);
  await navigate(redirectTo ?? "/");
}
