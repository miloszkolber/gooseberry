// -- Toggle ---------------------------------------------------

import { queryAll } from '../runtime/core.js';


export function enhance(root) {
  queryAll(root, '.toggle:not([data-init]):not(.toggle-group .toggle)').forEach((toggle) => {
  toggle.dataset.init = '';
  toggle.addEventListener('click', () => {
    const pressed = toggle.getAttribute('aria-pressed') === 'true';
    toggle.setAttribute('aria-pressed', !pressed);
  });
});
}

export const behavior = { name: 'toggle', enhance };
