// -- Input OTP --------------------------------------------------

import { queryAll } from '../runtime/core.js';


export function enhance(root) {
  const inputs = queryAll(root, '[data-input-otp]:not([data-init])');
  const ancestor = root?.nodeType === 1
    ? root.closest?.('[data-input-otp]:not([data-init])')
    : null;
  if (ancestor) inputs.push(ancestor);

  new Set(inputs).forEach((otp) => {
    otp.dataset.init = '';

    const cells = Array.from(otp.querySelectorAll('.input-otp-cell'));
    if (cells.length === 0) {
      otp.removeAttribute('data-init');
      return;
    }

    let wasComplete = cells.every((cell) => cell.value !== '');

    const markFilled = (cell) => {
      if (cell.value) cell.dataset.filled = '';
      else delete cell.dataset.filled;
    };

    const sync = (source) => {
      cells.forEach(markFilled);
      const value = cells.map((cell) => cell.value).join('');
      const complete = cells.every((cell) => cell.value !== '');

      otp.dispatchEvent(new CustomEvent('input-otp:change', {
        bubbles: true,
        detail: { value, source }
      }));

      if (complete && !wasComplete) {
        otp.dispatchEvent(new CustomEvent('input-otp:complete', {
          bubbles: true,
          detail: { value }
        }));
      }

      wasComplete = complete;
    };

    const distribute = (start, raw, source) => {
      const digits = raw.replace(/[^0-9]/g, '');
      if (!digits) return false;

      let last = start;
      Array.from(digits).some((digit, offset) => {
        const cell = cells[start + offset];
        if (!cell) return true;
        cell.value = digit;
        last = start + offset;
        return false;
      });

      sync(source);
      cells[Math.min(last + 1, cells.length - 1)]?.focus();
      return true;
    };

    cells.forEach((cell, index) => {
      markFilled(cell);

      cell.addEventListener('input', () => {
        const digits = cell.value.replace(/[^0-9]/g, '');
        if (digits.length > 1) {
          distribute(index, digits, 'input');
          return;
        }

        cell.value = digits.slice(-1);
        sync('input');
        if (cell.value && cells[index + 1]) cells[index + 1].focus();
      });

      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && cell.value === '' && cells[index - 1]) {
          event.preventDefault();
          const previous = cells[index - 1];
          previous.value = '';
          sync('backspace');
          previous.focus();
          return;
        }

        if (event.key === 'ArrowLeft' && cells[index - 1]) {
          event.preventDefault();
          cells[index - 1].focus();
          return;
        }

        if (event.key === 'ArrowRight' && cells[index + 1]) {
          event.preventDefault();
          cells[index + 1].focus();
        }
      });

      cell.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text') || '';
        if (!/[0-9]/.test(text)) return;
        event.preventDefault();
        distribute(index, text, 'paste');
      });
    });
  });
}

export const behavior = { name: 'input-otp', enhance };
