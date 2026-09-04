// -- Checkbox group enhancement ---------------------------------

import { queryAll } from '../runtime/core.js';


const CHECKBOX_GROUP_SELECTOR = '.checkbox-group:not([data-init]), [data-checkbox-group]:not([data-init])';

export function enhance(root) {
  queryAll(root, CHECKBOX_GROUP_SELECTOR).forEach((group) => {
    group.dataset.init = '';

    const selectAll = group.querySelector('[data-checkbox-all], .checkbox-group-select-all input[type="checkbox"]');
    const items = Array.from(group.querySelectorAll('[data-checkbox-item], .checkbox-group-items input[type="checkbox"]'))
      .filter((item) => item !== selectAll);
    const status = group.querySelector('[data-checkbox-status], .checkbox-group-status');
    if (!selectAll || items.length === 0) {
      group.removeAttribute('data-init');
      return;
    }

    const update = (source = 'sync', emit = true) => {
      const enabledItems = items.filter((item) => !item.disabled);
      const checkedItems = enabledItems.filter((item) => item.checked);
      const allChecked = enabledItems.length > 0 && checkedItems.length === enabledItems.length;
      const partiallyChecked = checkedItems.length > 0 && !allChecked;

      selectAll.checked = allChecked;
      selectAll.indeterminate = partiallyChecked;
      group.dataset.state = partiallyChecked ? 'partial' : allChecked ? 'complete' : 'empty';

      if (status) {
        status.textContent = enabledItems.length === 0
          ? 'No options available.'
          : `${checkedItems.length} of ${enabledItems.length} options selected.`;
      }

      if (emit) {
        group.dispatchEvent(new CustomEvent('checkbox-group:change', {
          bubbles: true,
          detail: {
            values: checkedItems.map((item) => item.value),
            selected: checkedItems.length,
            total: enabledItems.length,
            source
          }
        }));
      }
    };

    selectAll.addEventListener('change', () => {
      items.forEach((item) => {
        if (!item.disabled) item.checked = selectAll.checked;
      });
      update('select-all');
    });

    items.forEach((item) => {
      item.addEventListener('change', () => update('item'));
    });

    update('initial', false);
  });
}

export const behavior = { name: 'checkbox', enhance };
