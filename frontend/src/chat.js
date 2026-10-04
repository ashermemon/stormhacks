import * as THREE from 'three';
import { identity } from './identity.js';
import './chat.css';

const MAX_LOG_LINES = 50;
const LOG_FADE_MS = 12000;
const BUBBLE_MS = 6000;
const BUBBLE_GAP = 0.5; // world units above the nametag

/**
 * Chat log (bottom left), input box (Enter to open) and speech bubbles above avatars.
 *
 * net:       the connection returned by connect() in net.js
 * camera:    the scene camera, used to place bubbles on screen
 * getCharacter: (id) => Character | undefined, the character for a player id
 *
 * Call update() once per frame, after rendering.
 */
export function createChat({ net, camera, getCharacter }) {
  const root = document.createElement('div');
  root.id = 'chat';
  const logEl = document.createElement('div');
  logEl.id = 'chat-log';
  const input = document.createElement('input');
  input.id = 'chat-input';
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = 'Say something (Enter to send, Esc to cancel)';
  input.autocomplete = 'off';
  input.hidden = true;
  root.append(logEl, input);

  const bubbleLayer = document.createElement('div');
  bubbleLayer.id = 'chat-bubbles';
  document.body.append(root, bubbleLayer);

  const names = new Map(Object.entries(net.names)); // id -> name
  names.set(net.id, net.name);

  const lines = []; // { el, born }
  const bubbles = new Map(); // id -> { el, expires }

  function addLine(text, { author, kind } = {}) {
    const el = document.createElement('div');
    el.className = `chat-line${kind ? ` ${kind}` : ''}`;
    if (author) {
      const nameEl = document.createElement('span');
      nameEl.className = 'chat-name';
      nameEl.textContent = `${author}: `;
      el.append(nameEl);
    }
    el.append(document.createTextNode(text)); // text node: never parsed as HTML
    logEl.append(el);
    lines.push({ el, born: performance.now() });
    while (lines.length > MAX_LOG_LINES) lines.shift().el.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  function showBubble(id, text) {
    removeBubble(id);
    const el = document.createElement('div');
    el.className = 'chat-bubble';
    el.textContent = text;
    bubbleLayer.append(el);
    bubbles.set(id, { el, expires: performance.now() + BUBBLE_MS });
  }

  function removeBubble(id) {
    bubbles.get(id)?.el.remove();
    bubbles.delete(id);
  }

  // Server events.
  net.on('chat', ({ id, name, text }) => {
    names.set(id, name);
    addLine(text, { author: name });
    showBubble(id, text);
  });
  net.on('join', ({ id, name }) => {
    names.set(id, name);
    addLine(`${name} joined`, { kind: 'system' });
  });
  net.on('leave', ({ id }) => {
    addLine(`${names.get(id) ?? 'Someone'} left`, { kind: 'system' });
    names.delete(id);
    removeBubble(id);
  });
  net.on('renamed', ({ id, name }) => {
    addLine(`${names.get(id) ?? 'Someone'} is now ${name}`, { kind: 'system' });
    names.set(id, name);
    if (id === net.id) identity.setName(name);
  });
  net.on('error', ({ message }) => addLine(message, { kind: 'system error' }));

  // Input.
  const isTyping = () => !input.hidden;

  function open() {
    input.hidden = false;
    root.classList.add('open');
    input.focus();
  }

  function close() {
    input.value = '';
    input.hidden = true;
    root.classList.remove('open');
    input.blur();
  }
const noNoWords = ["fuck", "shit", "bitch", "cunt", "nigger", "faggot", "asshole", "dick", "pussy", "cock", "slut", "whore", "nigga", "fag", "bastard", "douchebag", "motherfucker", "twat", "retard","penis","sex","fvck","fock","fick"];
  function submit() {
    const text = input.value.trim();
    if (!text) return;
    if (text.startsWith('/name ')) {
      net.rename(text.slice(6).trim());
    } else if (text.startsWith('/')) {
      addLine('Unknown command. Try: /name <new name>', { kind: 'system' });
    } else {
      console.log(text)
      if(noNoWords.some(word => text.toLowerCase().includes(word))){
        addLine('Please use appropriate language.', { kind: 'system' });
      } else {
        net.sendChat(text);
      }
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && !isTyping()) {
      e.preventDefault();
      open();
    }
  });

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Enter') {
      submit();
      close();
    } else if (e.code === 'Escape') {
      close();
    }
  });

  addLine('Press Enter to chat. Use /name <new name> to rename.', { kind: 'system' });

  const projected = new THREE.Vector3();

  return {
    open,
    close,
    update() {
      const now = performance.now();

      for (const line of lines) {
        line.el.classList.toggle('faded', !isTyping() && now - line.born > LOG_FADE_MS);
      }

      for (const [id, bubble] of bubbles) {
        const character = getCharacter(id);
        if (!character || now > bubble.expires) {
          removeBubble(id);
          continue;
        }
        const { position } = character.root;
        projected
          .set(position.x, position.y + character.nametagHeight + BUBBLE_GAP, position.z)
          .project(camera);
        const visible = projected.z < 1;
        bubble.el.style.display = visible ? '' : 'none';
        if (visible) {
          const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
          const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
          bubble.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        }
      }
    },
  };
}
