// -- Navigation Menu -----------------------------------------

import { queryAll } from '../runtime/core.js';


export function enhance(root) {
  queryAll(root, '.nav-menu:not([data-init])').forEach((nav) => {
  nav.dataset.init = '';
  nav.querySelectorAll('.nav-menu-trigger[popovertarget]').forEach((trigger) => {
    const id = trigger.getAttribute('popovertarget');
    const content = nav.ownerDocument.getElementById(id);
    if (!content) return;

    const anchorId = `--nav-menu-${id}`;
    trigger.style.anchorName = anchorId;
    content.style.positionAnchor = anchorId;
  });
});
}

export const behavior = { name: 'navigation-menu', enhance };
