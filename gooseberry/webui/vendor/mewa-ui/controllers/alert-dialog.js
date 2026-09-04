// -- Alert Dialog ----------------------------------------------

import { queryAll } from '../runtime/core.js';


function openAlertDialog(dialog, trigger) {
  if (!dialog || !dialog.isConnected || typeof dialog.showModal !== 'function') return;
  if (dialog.open) return;
  dialog._trigger = trigger;
  try {
    dialog.showModal();
  } catch {
    // Do not surface a native InvalidStateError during SPA replacement.
  }
}

export function enhance(root) {
  const scope = root || (typeof document === 'undefined' ? null : document);
  const documentRoot = scope?.nodeType === 9 ? scope : scope?.ownerDocument;
  const dialogs = queryAll(scope, 'dialog.alert-dialog:not([data-init])');
  const triggerScope = dialogs.length && documentRoot ? documentRoot : scope;

  queryAll(triggerScope, '[data-alert-dialog-trigger]:not([data-init])').forEach((trigger) => {
    trigger.dataset.init = '';
    const dialogId = trigger.dataset.alertDialogTrigger;
    const triggerDocument = trigger.ownerDocument;
    if (!triggerDocument.getElementById(dialogId)) {
      delete trigger.dataset.init;
      return;
    }
    trigger.addEventListener('click', () => {
      openAlertDialog(triggerDocument.getElementById(dialogId), trigger);
    });
  });

  dialogs.forEach((dialog) => {
    dialog.dataset.init = '';

    dialog.querySelectorAll('[data-alert-dialog-close]').forEach((button) => {
      button.addEventListener('click', () => {
        dialog.close();
      });
    });

    dialog.addEventListener('close', () => {
      if (dialog._trigger?.isConnected) dialog._trigger.focus();
    });
  });
}

export const behavior = { name: 'alert-dialog', enhance };
