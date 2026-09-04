// -- Avatar ---------------------------------------------------

import { queryAll } from '../runtime/core.js';


export function enhance(root) {
  queryAll(root, '.avatar-image:not([data-init])').forEach((img) => {
  img.dataset.init = '';
  img.addEventListener('error', () => {
    img.setAttribute('data-error', '');
    img.style.display = 'none';
  });
});
}

export const behavior = { name: 'avatar', enhance };
