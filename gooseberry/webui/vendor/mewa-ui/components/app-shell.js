import { behavior as behavior0 } from "../controllers/app-shell.js";

export const behaviors = Object.freeze([behavior0]);
const statesByRoot = new WeakMap();

export function enhance(root, options) {
  const scope = root || (typeof document === "undefined" ? null : document);
  if (!scope) return [];
  const previous = statesByRoot.get(scope) || [];
  const states = behaviors.map((entry, index) => entry.enhance(scope, options) ?? previous[index]);
  statesByRoot.set(scope, states);
  return states;
}

export function destroy(root, states) {
  const scope = root || (typeof document === "undefined" ? null : document);
  if (!scope) return;
  const currentStates = states || statesByRoot.get(scope) || [];
  for (let index = behaviors.length - 1; index >= 0; index -= 1) {
    behaviors[index].destroy?.(scope, currentStates[index]);
  }
  statesByRoot.delete(scope);
}

export const behavior = { name: "app-shell", enhance, destroy };
