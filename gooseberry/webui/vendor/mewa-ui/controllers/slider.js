/* -- Slider component ------------------------------------------- */

import { queryAll } from '../runtime/core.js';


function updateSliderValue(el) {
  const min = parseFloat(el.min || 0);
  const max = parseFloat(el.max || 100);
  const value = parseFloat(el.value);
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  el.style.setProperty('--slider-value', `${percent}%`);
}

export function enhance(root) {
  queryAll(root, '.slider:not([data-init])').forEach((el) => {
    el.dataset.init = '';
    updateSliderValue(el);
    el.addEventListener('input', () => updateSliderValue(el));
  });
}

export const behavior = { name: 'slider', enhance };
