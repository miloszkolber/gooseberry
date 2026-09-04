// -- Color Picker -----------------------------------------------

import { queryAll } from '../runtime/core.js';


const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(raw) {
  const match = HEX_PATTERN.exec(raw.trim());
  if (!match) return null;

  const digits = match[1];
  const expanded = digits.length === 3
    ? Array.from(digits, (digit) => `${digit}${digit}`).join('')
    : digits;

  return `#${expanded.toLowerCase()}`;
}

export function enhance(scope) {
  queryAll(scope, '.color-picker:not([data-init])').forEach((root) => {
    root.dataset.init = '';

    const colorInput = root.querySelector('.color-picker-input[type="color"]');
    const hexInput = root.querySelector('[data-color-picker-hex]');
    if (!colorInput || !hexInput) {
      root.removeAttribute('data-init');
      return;
    }

    let valueAtFocus = colorInput.value;
    let updatingFromHex = false;

    const syncFromColor = () => {
      const normalized = normalizeHex(colorInput.value) || '#000000';
      colorInput.value = normalized;
      hexInput.value = normalized;
      hexInput.removeAttribute('aria-invalid');
    };

    const syncDisabled = () => {
      hexInput.disabled = colorInput.disabled;
    };

    syncFromColor();
    syncDisabled();
    hexInput.hidden = false;
    root.dataset.enhanced = '';

    colorInput.addEventListener('input', () => {
      if (!updatingFromHex) syncFromColor();
    });
    colorInput.addEventListener('change', syncFromColor);

    hexInput.addEventListener('focus', () => {
      valueAtFocus = colorInput.value;
    });

    hexInput.addEventListener('input', () => {
      const normalized = normalizeHex(hexInput.value);
      const draftIsInvalid = hexInput.value !== '' && !normalized;
      if (draftIsInvalid) hexInput.setAttribute('aria-invalid', 'true');
      else hexInput.removeAttribute('aria-invalid');

      if (!normalized || normalized === colorInput.value) return;
      colorInput.value = normalized;
      updatingFromHex = true;
      colorInput.dispatchEvent(new Event('input', { bubbles: true }));
      updatingFromHex = false;
    });

    hexInput.addEventListener('blur', () => {
      const normalized = normalizeHex(hexInput.value);
      if (!normalized) {
        syncFromColor();
        return;
      }

      hexInput.value = normalized;
      hexInput.removeAttribute('aria-invalid');
      if (colorInput.value !== valueAtFocus) {
        colorInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    hexInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      hexInput.blur();
    });
  });
}

export const behavior = { name: 'color-picker', enhance };
