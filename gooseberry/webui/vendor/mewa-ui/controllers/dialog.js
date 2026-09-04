// -- Dialog ---------------------------------------------------

import { queryAll } from '../runtime/core.js';


function openDialog(dialog, trigger) {
  if (!dialog || !dialog.isConnected || typeof dialog.showModal !== 'function') return;
  if (dialog.open) return;
  dialog._trigger = trigger;
  try {
    dialog.showModal();
  } catch {
    // A detached or already-open dialog can race SPA updates.
  }
}

function focusableElements(dialog) {
  const selector = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"]):not([disabled]):not([type="hidden"])'
  ].join(',');
  return Array.from(dialog.querySelectorAll(selector))
    .filter((element) => !element.matches(':disabled') && !element.closest('[hidden], [inert]'));
}

function initDialogTrigger(trigger) {
  trigger.dataset.init = '';
  const dialogId = trigger.dataset.dialogTrigger;
  const ownerDocument = trigger.ownerDocument;
  if (!ownerDocument.getElementById(dialogId)) {
    delete trigger.dataset.init;
    return;
  }
  trigger.addEventListener('click', () => {
    openDialog(ownerDocument.getElementById(dialogId), trigger);
  });
}

export function enhance(root) {
  const dialogs = queryAll(root, 'dialog:not(.alert-dialog):not(.sheet):not([data-init])');
  queryAll(root, '[data-dialog-trigger]:not([data-init])').forEach(initDialogTrigger);

  dialogs.forEach((dialog) => {
    dialog.dataset.init = '';

    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !dialog.open) return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && dialog.ownerDocument.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && dialog.ownerDocument.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });

    dialog.addEventListener('close', () => {
      if (dialog._trigger?.isConnected) dialog._trigger.focus();
    });
  });

  if (dialogs.length) {
    queryAll(dialogs[0].ownerDocument, '[data-dialog-trigger]:not([data-init])')
      .forEach(initDialogTrigger);
  }
}

export const behavior = { name: 'dialog', enhance };
