const SERVER_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/**
 * Connects to the relay server. Resolves once the welcome message arrives.
 * handlers: { onState(id, state), onLeave(id), onClose() }
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

    ws.addEventListener('error', () => {
      if (!welcomed) reject(new Error(`Could not connect to ${SERVER_URL}`));
    });

    ws.addEventListener('close', () => {
      if (welcomed) handlers.onClose();
      else reject(new Error(`Could not connect to ${SERVER_URL}`));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'welcome':
          welcomed = true;
          resolve({
            id: msg.id,
            players: msg.players,
            sendState(state) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'state', state }));
              }
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
    });
  });
}
