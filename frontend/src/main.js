import { startGame } from './game.js';
import { identity } from './identity.js';

const menu = document.getElementById('menu');
const playBtn = document.getElementById('play-btn');
const nameInput = document.getElementById('name-input');
const status = document.getElementById('status');

nameInput.value = identity.getName();

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') playBtn.click();
});

playBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) {
    status.textContent = 'Enter a name first.';
    nameInput.focus();
    return;
  }
  identity.setName(name);

  playBtn.disabled = true;
  status.textContent = 'Connecting...';
  try {
    await startGame();
    menu.remove();
  } catch (error) {
    console.error(error);
    status.textContent = error.message;
    playBtn.disabled = false;
  }
});
