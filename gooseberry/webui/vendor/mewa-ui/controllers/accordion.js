// -- Accordion -----------------------------------------------

import { queryAll } from '../runtime/core.js';


export function enhance(root) {
  queryAll(root, '.accordion[data-type="single"]:not([data-init])').forEach((accordion) => {
  accordion.dataset.init = '';
  const items = accordion.querySelectorAll('.accordion-item');
  const collapsible = accordion.hasAttribute('data-collapsible');
  items.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (item.open) {
        items.forEach((sibling) => {
          if (sibling !== item && sibling.open) sibling.open = false;
        });
      } else if (!collapsible) {
        const anyOpen = Array.from(items).some((i) => i.open);
        if (!anyOpen) item.open = true;
      }
    });
  });
});
}

export const behavior = { name: 'accordion', enhance };
