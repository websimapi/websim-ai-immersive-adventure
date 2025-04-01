import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// --- Configuration ---
const INITIAL_PROMPT = "A tranquil wilderness campsite at dusk, featuring a crackling campfire casting warm light on nearby tents nestled under towering pine trees. The soft rustling of leaves can be heard in a gentle breeze under a twilight sky.";
const IMAGE_WIDTH = 3840;
const IMAGE_HEIGHT = 2160;
const CAMERA_FOV = 75; // Field of View
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const MOUSE_SENSITIVITY = 0.002; // Adjust for faster/slower panning

// --- DOM Elements ---
const container = document.getElementById('panorama-container');
const labelContainer = document.getElementById('label-container');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');
const promptDisplay = document.getElementById('prompt-display');
const creditsIcon = document.getElementById('credits-icon');
const creditsModal = document.getElementById('credits-modal');
const closeCreditsButton = document.getElementById('close-credits');

// --- State ---
let scene, camera, renderer, textureLoader, css2dRenderer;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let panoramaMesh; // To hold the sphere mesh
let totalYaw = Math.PI / 2; // Keep track of total horizontal rotation, START FACING LEFT
let currentLabels = [];

// --- Initialization ---
async function init() {
    promptDisplay.textContent = `Prompt: ${INITIAL_PROMPT}`;

    // Scene setup
    scene = new THREE.Scene();

    // Camera setup
    camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(0, 0, 0.1);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = totalYaw;

    // Renderer setup
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // CSS2D Renderer Setup
    css2dRenderer = new CSS2DRenderer();
    css2dRenderer.setSize(window.innerWidth, window.innerHeight);
    css2dRenderer.domElement.style.position = 'absolute';
    css2dRenderer.domElement.style.top = '0px';
    css2dRenderer.domElement.style.pointerEvents = 'none'; 
    labelContainer.appendChild(css2dRenderer.domElement); 


    // Texture Loader
    textureLoader = new THREE.TextureLoader();

    try {
        // Generate initial panorama
        await generateAndLoadPanorama(INITIAL_PROMPT);
    } catch (error) {
        console.error("Initialization failed:", error);
        loadingIndicator.style.display = 'none';
        errorMessage.style.display = 'block';
        errorMessage.querySelector('p').textContent = `Error: ${error.message || 'An unknown error occurred during initialization.'}`;
        return;
    }

    // Event Listeners
    setupEventListeners();

    // Start animation loop
    animate();
}

// --- Panorama Generation and Loading ---
async function generateAndLoadPanorama(prompt) {
    console.log("Generating image for prompt:", prompt);
    loadingIndicator.style.display = 'block';
    errorMessage.style.display = 'none';
    promptDisplay.textContent = `Prompt: ${prompt}`;
    clearLabels(); 

    try {
        const imagePrompt = `${prompt}. Photorealistic equirectangular panorama 360 view, ultra high definition.`;
        console.log("Image Gen Prompt:", imagePrompt);
        const result = await websim.imageGen({
            prompt: imagePrompt,
            width: IMAGE_WIDTH,
            height: IMAGE_HEIGHT,
        });
        const imageUrl = result.url; 

        console.log("Image generated:", imageUrl);

        await new Promise((resolve, reject) => {
            textureLoader.load(
                imageUrl,
                (texture) => {
                    console.log("Texture loaded successfully");

                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    texture.colorSpace = THREE.SRGBColorSpace;

                    if (panoramaMesh) {
                        scene.remove(panoramaMesh);
                        panoramaMesh.geometry.dispose();
                        if (panoramaMesh.material.map) panoramaMesh.material.map.dispose();
                        panoramaMesh.material.dispose();
                    }

                    const geometry = new THREE.SphereGeometry(500, 60, 40);
                    geometry.scale(-1, 1, 1);
                    const material = new THREE.MeshBasicMaterial({ map: texture });
                    panoramaMesh = new THREE.Mesh(geometry, material);
                    scene.add(panoramaMesh);

                    detectAndLabelObjects(imageUrl)
                        .then(() => console.log("Object detection and labeling complete."))
                        .catch(err => {
                             console.error("Object detection/labeling failed:", err);
                        })
                        .finally(() => {
                            loadingIndicator.style.display = 'none'; 
                        });

                    resolve(); 
                },
                undefined, 
                (error) => {
                    console.error('Error loading texture:', error);
                    loadingIndicator.style.display = 'none'; 
                    errorMessage.style.display = 'block';
                    errorMessage.querySelector('p').textContent = 'Error: Failed to load panorama texture.';
                    reject(new Error('Failed to load panorama texture.')); 
                }
            );
        }); 

    } catch (error) {
        console.error("Error generating image:", error);
        loadingIndicator.style.display = 'none';
        errorMessage.style.display = 'block';
        errorMessage.querySelector('p').textContent = `Error: ${error.message || 'Failed to generate panorama image.'}`;
        throw new Error('Failed to generate panorama image.'); 
    }
}

// --- Object Detection and Labeling (NEW) ---
async function detectAndLabelObjects(imageUrl) {
    console.log("Starting object detection for:", imageUrl);

    try {
        const completion = await websim.chat.completions.create({
            messages: [
                 {
                    role: "system",
                    content: `Analyze the provided equirectangular panorama image. Identify key objects within the scene.
Respond ONLY with a JSON array, following this schema: [{ "label": "object name", "x": number, "y": number }]
'x' and 'y' MUST be normalized coordinates (0.0 to 1.0) representing the CENTER of the detected object in the flat image. 'x' is horizontal (0=left, 1=right), 'y' is vertical (0=top, 1=bottom).
Example: [{"label": "tent", "x": 0.6, "y": 0.7}, {"label": "tree", "x": 0.2, "y": 0.4}]
Be concise with labels. Limit results to the 5-10 most prominent objects. Do not include preamble or explanation.`,
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Detect objects and their center coordinates in this 360 panorama." },
                        { type: "image_url", image_url: { url: imageUrl } },
                    ],
                },
            ],
            json: true, 
        });

        const detectedObjects = JSON.parse(completion.content);
        console.log("Detected objects:", detectedObjects);

        if (!Array.isArray(detectedObjects)) {
            throw new Error("AI response was not a valid JSON array.");
        }

        const sphereRadius = 500; 

        detectedObjects.forEach(obj => {
            if (typeof obj.label !== 'string' || typeof obj.x !== 'number' || typeof obj.y !== 'number' || obj.label.trim() === '') {
                console.warn("Skipping invalid object data:", obj);
                return; 
            }

            const x = Math.max(0, Math.min(1, obj.x));
            const y = Math.max(0, Math.min(1, obj.y));

            const phi = y * Math.PI;
            const theta = x * 2 * Math.PI;

            const position = new THREE.Vector3();
            position.setFromSphericalCoords(sphereRadius - 1, phi, theta);

            const labelDiv = document.createElement('div');
            labelDiv.className = 'object-label';
            labelDiv.textContent = obj.label;

            const label = new CSS2DObject(labelDiv);
            label.position.copy(position);
            scene.add(label);
            currentLabels.push(label); 
        });

    } catch (error) {
        console.error("Error during object detection or label creation:", error);
        if (errorMessage.style.display === 'none') {
            console.warn("Object detection could not be completed.");
        }
    }
}

// --- Clear Labels (NEW) ---
function clearLabels() {
    currentLabels.forEach(label => {
        if (label.parent) { 
             label.parent.remove(label); 
        }
        if (label.element && label.element.parentNode) {
            label.element.parentNode.removeChild(label.element);
        }
    });
    currentLabels = []; 
    console.log("Cleared previous labels.");
}


// --- Event Listeners ---
function setupEventListeners() {
    container.addEventListener('mousedown', onPointerDown);
    container.addEventListener('mousemove', onPointerMove);
    container.addEventListener('mouseup', onPointerUp);
    container.addEventListener('mouseleave', onPointerUp); 

    container.addEventListener('touchstart', onPointerDown, { passive: false });
    container.addEventListener('touchmove', onPointerMove, { passive: false });
    container.addEventListener('touchend', onPointerUp);
    container.addEventListener('touchcancel', onPointerUp);

    window.addEventListener('resize', onWindowResize);

    creditsIcon.addEventListener('click', openCredits);
    closeCreditsButton.addEventListener('click', closeCredits);
}

function getClientPosition(event) {
    if (event.touches && event.touches.length > 0) {
        return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else {
        return { x: event.clientX, y: event.clientY };
    }
}

function onPointerDown(event) {
    if ((event.button && event.button !== 0) && !event.touches) return; 
    if (event.touches && event.touches.length > 1) return; 

    isDragging = true;
    const pos = getClientPosition(event);
    previousMousePosition.x = pos.x;
    previousMousePosition.y = pos.y;
    container.style.cursor = 'grabbing'; 

    if (event.touches) event.preventDefault();
}

function onPointerMove(event) {
    if (!isDragging) return;
    if (event.touches) event.preventDefault();

    const pos = getClientPosition(event);
    const deltaX = pos.x - previousMousePosition.x;
    const deltaY = pos.y - previousMousePosition.y;

    rotateCamera(deltaX, deltaY);

    previousMousePosition.x = pos.x;
    previousMousePosition.y = pos.y;
}

function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    container.style.cursor = 'grab'; 
}

function rotateCamera(deltaX, deltaY) {
    const yawAngle = -deltaX * MOUSE_SENSITIVITY;
    const pitchAngle = -deltaY * MOUSE_SENSITIVITY;

    const potentialYaw = totalYaw + yawAngle;
    const startAngle = Math.PI / 2;
    const yawLimitRange = (100 * Math.PI) / 180;
    const minYaw = startAngle - yawLimitRange;
    const maxYaw = startAngle + yawLimitRange;
    totalYaw = Math.max(minYaw, Math.min(maxYaw, potentialYaw));
    camera.rotation.y = totalYaw;

    const maxPitch = Math.PI / 2 - 0.05;
    const minPitch = -Math.PI / 2 + 0.05;
    camera.rotation.x += pitchAngle;
    camera.rotation.x = Math.max(minPitch, Math.min(maxPitch, camera.rotation.x));
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    css2dRenderer.setSize(window.innerWidth, window.innerHeight); 
}

// --- Credits UI Functions ---
function openCredits() {
    creditsModal.style.display = 'block';
}

function closeCredits() {
    creditsModal.style.display = 'none';
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate); 
    renderer.render(scene, camera); 
    css2dRenderer.render(scene, camera); 
}

// --- Start ---
init().catch(err => {
    console.error("Initialization failed in catch block:", err);
    loadingIndicator.style.display = 'none';
    errorMessage.style.display = 'block';
    errorMessage.querySelector('p').textContent = `Error: ${err.message || 'An unknown error occurred during initialization.'}`;
});