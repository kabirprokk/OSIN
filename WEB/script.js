'use strict';

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-nav');

menuButton.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
  navigation.classList.toggle('is-open', !isOpen);
});

navigation.addEventListener('click', event => {
  if (event.target.closest('a')) {
    navigation.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
  }
});

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const status = document.querySelector('.copy-status');
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'COPIED';
      button.dataset.copied = 'true';
      button.setAttribute('aria-label', 'Command copied to clipboard');
      if (status) status.textContent = 'Copied command to clipboard.';
      window.setTimeout(() => {
        button.textContent = 'COPY';
        delete button.dataset.copied;
        button.setAttribute('aria-label', `Copy command: ${button.dataset.copy}`);
      }, 1800);
    } catch {
      if (status) status.textContent = 'Clipboard access is unavailable. Select and copy the command instead.';
    }
  });
});