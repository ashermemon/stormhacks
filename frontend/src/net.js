import { identity } from './identity.js';
const SERVER_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
console.log(SERVER_URL);
/**
 * Connects to the relay server. Resolves once the welcome message arrives.
 * handlers: { onState(id, state), onLeave(id), onClose() }
 * Identifies with the stored token and name (see identity.js). Rejects with the
 * server's message if the name is invalid or taken.
 */
export function connect(handlers) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(SERVER_URL);
    } catch (error) {
      reject(error);
      return;
    }

    let welcomed = false;
    const listeners = new Map();

    const send = (message) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    ws.addEventListener('open', () => {
      send({ type: 'hello', token: identity.getToken(), name: identity.getName() });
    });

    ws.addEventListener('error', () => {
      if (!welcomed) reject(new Error(`Could not connect to ${SERVER_URL}`));
    });

    ws.addEventListener('close', () => {
      if (welcomed) handlers.onClose();
      else reject(new Error(`Could not connect to ${SERVER_URL}`));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      console.log('Received message:', event.data);
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'error' && !welcomed) {
        reject(new Error(msg.message));
        return;
      }
      switch (msg.type) {
        case 'welcome':
          welcomed = true;
          identity.setToken(msg.token);
          identity.setName(msg.name);
          resolve({
            id: msg.id,
            name: msg.name,
            players: msg.players,
            names: msg.names,
            /** Subscribe to any server message type (chat, join, leave, renamed, error, ...). */
            on(type, fn) {
              if (!listeners.has(type)) listeners.set(type, []);
              listeners.get(type).push(fn);
            },
            sendState(state) {
              send({ type: 'state', state });
            },
            sendChat(text) {
              send({ type: 'chat', text });
            },
            rename(name) {
              send({ type: 'rename', name });
            },
          });
          break;
        case 'state':
          handlers.onState(msg.id, msg.state);
          break;
        case 'leave':
          handlers.onLeave(msg.id);
          break;
      }
      listeners.get(msg.type)?.forEach((fn) => fn(msg));
    });
  });
}
