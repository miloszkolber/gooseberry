// -- App shell theme enhancement -------------------------------

import { queryAll } from '../runtime/core.js';


const APP_SHELL_THEME_KEY = 'mewa-ui-theme';
const APP_SHELL_LEGACY_THEME_KEY = 'mewa-theme';
const initializedDocuments = new WeakSet();

function documentView(documentRoot) {
  return documentRoot.defaultView || (typeof window === 'undefined' ? null : window);
}

function readStoredTheme(view) {
  try {
    const value = view?.localStorage?.getItem(APP_SHELL_THEME_KEY)
      || view?.localStorage?.getItem(APP_SHELL_LEGACY_THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(view, theme) {
  try {
    view?.localStorage?.setItem(APP_SHELL_THEME_KEY, theme);
  } catch {
    // Restricted storage still gets an in-page theme change.
  }
}

function preferredTheme(view) {
  return view?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncToggle(toggle, documentRoot = toggle.ownerDocument) {
  const dark = documentRoot.documentElement.classList.contains('dark');
  toggle.dataset.theme = dark ? 'dark' : 'light';
  toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

function applyTheme(documentRoot, theme) {
  documentRoot.documentElement.classList.toggle('dark', theme === 'dark');
  queryAll(documentRoot, '[data-theme-toggle][data-init]').forEach((toggle) => {
    syncToggle(toggle, documentRoot);
  });
}

function initializeDocument(documentRoot) {
  if (initializedDocuments.has(documentRoot)) return;
  initializedDocuments.add(documentRoot);

  const view = documentView(documentRoot);
  applyTheme(documentRoot, readStoredTheme(view) || preferredTheme(view));

  const colorScheme = view?.matchMedia?.('(prefers-color-scheme: dark)');
  colorScheme?.addEventListener('change', (event) => {
    if (!readStoredTheme(view)) applyTheme(documentRoot, event.matches ? 'dark' : 'light');
  });
}

export function enhance(root) {
  const scope = root || (typeof document === 'undefined' ? null : document);
  const documentRoot = scope?.nodeType === 9 ? scope : scope?.ownerDocument;
  if (!documentRoot) return;

  initializeDocument(documentRoot);
  queryAll(scope, '[data-theme-toggle]:not([data-init])').forEach((toggle) => {
    toggle.dataset.init = '';
    syncToggle(toggle, documentRoot);
    toggle.addEventListener('click', () => {
      const theme = documentRoot.documentElement.classList.contains('dark') ? 'light' : 'dark';
      writeStoredTheme(documentView(documentRoot), theme);
      applyTheme(documentRoot, theme);
    });
  });
}

export const behavior = { name: 'app-shell', enhance };
