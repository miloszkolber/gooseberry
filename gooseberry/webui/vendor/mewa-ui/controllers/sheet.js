// -- Sheet ----------------------------------------------------

import { queryAll } from '../runtime/core.js';


function openSheet(sheet, trigger) {
  if (!sheet || !sheet.isConnected || typeof sheet.showModal !== 'function') return;
  if (sheet.open) return;
  sheet._trigger = trigger;
  try {
    sheet.showModal();
    // Keep initial focus on the surface. showModal() would otherwise focus
    // the first control and select its text.
    if (!sheet.hasAttribute('tabindex')) sheet.setAttribute('tabindex', '-1');
    sheet.focus();
  } catch {
    // A target can be replaced between the click and showModal() in an SPA.
  }
}

function initSheetTrigger(trigger) {
  trigger.dataset.init = '';
  const sheetId = trigger.dataset.sheetTrigger;
  const ownerDocument = trigger.ownerDocument;
  if (!ownerDocument.getElementById(sheetId)) {
    delete trigger.dataset.init;
    return;
  }
  trigger.addEventListener('click', () => {
    openSheet(ownerDocument.getElementById(sheetId), trigger);
  });
}

export function enhance(root) {
  const sheets = queryAll(root, 'dialog.sheet:not([data-init])');
  queryAll(root, '[data-sheet-trigger]:not([data-init])').forEach(initSheetTrigger);

  sheets.forEach((sheet) => {
    sheet.dataset.init = '';
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) sheet.close();
    });
    sheet.querySelectorAll('[data-sheet-close]').forEach((btn) => {
      btn.addEventListener('click', () => { sheet.close(); });
    });
    sheet.addEventListener('close', () => {
      if (sheet._trigger?.isConnected) sheet._trigger.focus();
    });
  });

  if (sheets.length) {
    queryAll(sheets[0].ownerDocument, '[data-sheet-trigger]:not([data-init])')
      .forEach(initSheetTrigger);
  }
}

export const behavior = { name: 'sheet', enhance };
