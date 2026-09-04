// -- Popover --------------------------------------------------

import { queryAll } from '../runtime/core.js';


function initPopoverTrigger(trigger) {
  trigger.dataset.init = '';
  const id = trigger.getAttribute('popovertarget');
  const popover = trigger.ownerDocument.getElementById(id);
  if (!popover || !popover.classList.contains('popover')) {
    delete trigger.dataset.init;
    return;
  }

  const anchorId = `--popover-${id}`;
  trigger.style.anchorName = anchorId;
  popover.style.positionAnchor = anchorId;
}

export function enhance(root) {
  const popovers = queryAll(root, '.popover[id]');
  queryAll(root, '[popovertarget]:not([data-init])').forEach(initPopoverTrigger);
  if (popovers.length) {
    queryAll(popovers[0].ownerDocument, '[popovertarget]:not([data-init])')
      .forEach(initPopoverTrigger);
  }
}

export const behavior = { name: 'popover', enhance };
