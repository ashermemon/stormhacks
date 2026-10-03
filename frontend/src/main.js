import * as THREE from 'three';



 
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshNormalMaterial()
);
scene.add(cube);

document.getElementById('host-btn').addEventListener('click', () => {
  // TODO: host a game



});
document.getElementById('join-btn').addEventListener('click', async () => {
  try {
    const result = await joinGame();
    console.log('Joined game:', result);
  } catch (error) {
    console.error('Failed to join:', error);
  }
});

function joinGame() {

  return new Promise((resolve, reject) => {
       let webSocket
    try {
  webSocket= new WebSocket(
      'wss://konstantin-macbook-6.miku-harmonic.ts.net/'
    );
    
  } catch (error) {
    alert('Failed to create WebSocket connection. Please check your network and try again.');
    reject(new Error('Failed to create WebSocket connection'));
  }

    webSocket.addEventListener('open', () => {
      const joinRequest = {
        type: 'request',
        action: 'join',
        data: {
          // Add any necessary data here
        }
      };

      webSocket.send(JSON.stringify(joinRequest));
    });

    webSocket.addEventListener('message', (event) => {
   
    const message = JSON.parse(event.data);

      console.log('Received message:', message);


    });

    webSocket.addEventListener('error', () => {
      reject(new Error('WebSocket connection failed'));
    });

    webSocket.addEventListener('close', () => {
      // Only reject if the Promise hasn't already resolved.
      // You can add additional handling here if needed.
      alert("Server closed the connection. Please try again later.");
    });
  });
}

renderer.setAnimationLoop(() => {
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
});
