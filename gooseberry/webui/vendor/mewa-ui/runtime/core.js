function defaultDocument() {
  return typeof document === 'undefined' ? null : document;
}

export function queryAll(root, selector) {
  const scope = root || defaultDocument();
  if (!scope) return [];

  const matches = [];
  if (scope.nodeType === 1 && scope.matches?.(selector)) matches.push(scope);
  if (typeof scope.querySelectorAll === 'function') matches.push(...scope.querySelectorAll(selector));
  return matches;
}

export function createController(behavior, root, options) {
  if (!behavior || typeof behavior.enhance !== 'function') {
    throw new TypeError('A Mewa behavior with an enhance function is required.');
  }
  if (!root) throw new TypeError('A root element is required.');

  let currentOptions = options;
  let state = behavior.enhance(root, currentOptions);
  let active = true;

  return {
    element: root,
    update(nextOptions = currentOptions) {
      if (!active) return;
      currentOptions = nextOptions;
      state = behavior.enhance(root, currentOptions) ?? state;
    },
    destroy() {
      if (!active) return;
      active = false;
      behavior.destroy?.(root, state);
    }
  };
}
