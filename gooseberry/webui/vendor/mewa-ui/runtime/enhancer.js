function defaultDocument() {
  return typeof document === 'undefined' ? null : document;
}

function assertBehavior(behavior) {
  if (!behavior || typeof behavior.name !== 'string' || typeof behavior.enhance !== 'function') {
    throw new TypeError('A Mewa behavior requires a name and an enhance function.');
  }
}

export function createEnhancer(initialBehaviors = []) {
  const behaviors = new Map();
  let observer = null;
  let observedRoot = null;

  function enhance(root = defaultDocument()) {
    if (!root) return;
    behaviors.forEach((behavior) => behavior.enhance(root));
  }

  function destroy(root) {
    if (!root) return;
    behaviors.forEach((behavior) => behavior.destroy?.(root));
  }

  function observe(root = defaultDocument()) {
    if (!root || typeof MutationObserver === 'undefined') return () => {};
    if (observer && observedRoot === root) {
      const currentObserver = observer;
      return () => {
        if (observer === currentObserver) disconnect();
      };
    }

    disconnect();
    observedRoot = root;
    observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.removedNodes.forEach((node) => destroy(node));
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1 || node.nodeType === 11) enhance(node);
        });
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    const currentObserver = observer;
    return () => {
      if (observer === currentObserver) disconnect();
    };
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
    observedRoot = null;
  }

  function register(behavior) {
    assertBehavior(behavior);
    behaviors.set(behavior.name, behavior);
    return () => {
      if (behaviors.get(behavior.name) === behavior) behaviors.delete(behavior.name);
    };
  }

  initialBehaviors.forEach(register);

  return {
    register,
    enhance,
    destroy,
    observe,
    disconnect,
    get behaviors() {
      return Array.from(behaviors.values());
    }
  };
}

const autoEnhancer = createEnhancer();

export function registerBehavior(behavior) {
  const unregister = autoEnhancer.register(behavior);
  const root = defaultDocument();
  if (root) {
    behavior.enhance(root);
    autoEnhancer.observe(root);
  }
  return () => {
    if (root) behavior.destroy?.(root);
    unregister();
    if (autoEnhancer.behaviors.length === 0) autoEnhancer.disconnect();
  };
}

export function enhance(root) {
  autoEnhancer.enhance(root);
}

export function observe(root) {
  return autoEnhancer.observe(root);
}

export function disconnect() {
  autoEnhancer.disconnect();
}
