// SEVERANCE — entry point (placeholder during scaffolding; replaced in later milestones)
import * as THREE from 'three';
import assets from 'virtual:assets';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
cam.position.z = 3;
scene.add(new THREE.DirectionalLight(0xffffff, 3));
const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.7, 0.2, 128, 16), new THREE.MeshStandardMaterial({ color: 0x889988 }));
scene.add(mesh);
renderer.setAnimationLoop((t) => { mesh.rotation.y = t / 1000; renderer.render(scene, cam); });
console.log('SEVERANCE scaffold', THREE.REVISION, Object.keys(assets).length, 'assets');
