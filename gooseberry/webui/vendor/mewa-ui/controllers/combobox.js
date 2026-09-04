// -- Combobox -------------------------------------------------

import { queryAll } from '../runtime/core.js';


export function enhance(root) {
  queryAll(root, '.combobox:not([data-init])').forEach((wrapper) => {
    wrapper.dataset.init = '';

    const trigger = wrapper.querySelector('.combobox-trigger');
    const valueElement = wrapper.querySelector('.combobox-value');
    const popover = wrapper.querySelector('.combobox-content');
    const searchRow = wrapper.querySelector('.combobox-search');
    const searchInput = wrapper.querySelector('.combobox-search-input');
    const listbox = wrapper.querySelector('[role="listbox"]');
    const hiddenInput = wrapper.querySelector('[data-combobox-input]');
    const emptyState = wrapper.querySelector('.combobox-empty');

    if (!trigger || !popover || !searchInput || !listbox) return;

    const allItems = Array.from(listbox.querySelectorAll('[role="option"]'));
    let highlightedIndex = -1;

    if (!searchInput.hasAttribute('aria-label') && !searchInput.hasAttribute('aria-labelledby')) {
      const triggerLabel = trigger.getAttribute('aria-label');
      if (triggerLabel) searchInput.setAttribute('aria-label', `Search ${triggerLabel}`);
    }

    const anchorId = `--combobox-${popover.id}`;
    trigger.style.anchorName = anchorId;
    popover.style.positionAnchor = anchorId;

    const getVisibleItems = () => allItems.filter((item) => (
      !item.hidden && item.getAttribute('aria-disabled') !== 'true'
    ));

    const setExpanded = (expanded) => {
      const value = String(expanded);
      trigger.setAttribute('aria-expanded', value);
      searchInput.setAttribute('aria-expanded', value);
    };

    const clearHighlight = () => {
      allItems.forEach((item) => {
        delete item.dataset.highlighted;
      });
      highlightedIndex = -1;
      searchInput.setAttribute('aria-activedescendant', '');
    };

    const highlight = (index) => {
      const items = getVisibleItems();
      clearHighlight();
      if (index < 0 || index >= items.length) return;

      const item = items[index];
      highlightedIndex = index;
      item.dataset.highlighted = '';
      item.scrollIntoView({ block: 'nearest' });
      searchInput.setAttribute('aria-activedescendant', item.id);
    };

    const updateGroupVisibility = () => {
      listbox.querySelectorAll('.combobox-group-label').forEach((label) => {
        let next = label.nextElementSibling;
        let groupHasVisibleItem = false;

        while (
          next
          && !next.classList.contains('combobox-group-label')
          && !next.classList.contains('combobox-separator')
        ) {
          if (next.getAttribute('role') === 'option' && !next.hidden) {
            groupHasVisibleItem = true;
          }
          next = next.nextElementSibling;
        }

        label.hidden = !groupHasVisibleItem;
      });

      listbox.querySelectorAll('.combobox-separator').forEach((separator) => {
        const previous = separator.previousElementSibling;
        const next = separator.nextElementSibling;
        separator.hidden = Boolean((previous && previous.hidden) || (next && next.hidden));
      });
    };

    const filter = (query) => {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      let hasVisibleItem = false;

      allItems.forEach((item) => {
        const label = item.textContent.trim().toLocaleLowerCase();
        const match = !normalizedQuery || label.includes(normalizedQuery);
        item.hidden = !match;
        if (match) hasVisibleItem = true;
      });

      updateGroupVisibility();
      if (emptyState) emptyState.hidden = hasVisibleItem;
    };

    const writeSelection = (item, { announce = true } = {}) => {
      if (!item || item.getAttribute('aria-disabled') === 'true') return;

      allItems.forEach((option) => {
        option.setAttribute('aria-selected', String(option === item));
      });

      if (valueElement) {
        valueElement.textContent = item.textContent.trim();
        valueElement.removeAttribute('data-placeholder');
      }

      if (hiddenInput) {
        hiddenInput.value = item.dataset.value ?? item.textContent.trim();
        if (announce) {
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    };

    const close = ({ restoreFocus = true } = {}) => {
      if (popover.matches(':popover-open')) popover.hidePopover();
      setExpanded(false);
      clearHighlight();
      if (restoreFocus) trigger.focus();
    };

    const open = () => {
      popover.showPopover();
      setExpanded(true);
      searchInput.value = '';
      filter('');
      clearHighlight();
      searchInput.focus();
    };

    const selectItem = (item) => {
      writeSelection(item);
      close();
    };

    const selectedItem = allItems.find((item) => item.getAttribute('aria-selected') === 'true');
    if (selectedItem) writeSelection(selectedItem, { announce: false });

    trigger.addEventListener('click', () => {
      if (popover.matches(':popover-open')) close();
      else open();
    });

    searchInput.addEventListener('input', () => {
      filter(searchInput.value);
      highlight(0);
    });

    searchRow?.addEventListener('click', () => {
      searchInput.focus();
    });

    searchInput.addEventListener('keydown', (event) => {
      const items = getVisibleItems();

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          highlight(Math.min(highlightedIndex + 1, items.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          highlight(highlightedIndex < 0 ? items.length - 1 : Math.max(highlightedIndex - 1, 0));
          break;
        case 'Home':
          event.preventDefault();
          highlight(0);
          break;
        case 'End':
          event.preventDefault();
          highlight(items.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          if (highlightedIndex >= 0 && items[highlightedIndex]) selectItem(items[highlightedIndex]);
          break;
        case 'Escape':
          event.preventDefault();
          close();
          break;
        case 'Tab':
          close({ restoreFocus: false });
          break;
      }
    });

    listbox.addEventListener('click', (event) => {
      const item = event.target.closest('[role="option"]');
      if (item && !item.hidden) selectItem(item);
    });

    listbox.addEventListener('mousemove', (event) => {
      const item = event.target.closest('[role="option"]');
      if (!item || item.hidden || item.getAttribute('aria-disabled') === 'true') return;

      const items = getVisibleItems();
      highlight(items.indexOf(item));
    });

    popover.addEventListener('toggle', (event) => {
      const expanded = event.newState === 'open';
      setExpanded(expanded);
      if (!expanded) clearHighlight();
    });
  });
}

export const behavior = { name: 'combobox', enhance };
