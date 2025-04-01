import * as THREE from 'three';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// --- Configuration ---
const INITIAL_PROMPT = "A tranquil wilderness campsite at dusk, featuring a crackling campfire casting warm light on nearby tents nestled under towering pine trees. The soft rustling of leaves can be heard in a gentle breeze under a twilight sky.";
const IMAGE_WIDTH = 3840; 
const IMAGE_HEIGHT = 2160;
const CAMERA_FOV = 75; 
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const MOUSE_SENSITIVITY = 0.002; 
const OBJECT_DETECTION_CONFIDENCE_THRESHOLD = 0.5; 

// --- DOM Elements ---
const container = document.getElementById('panorama-container');
const loadingIndicator = document.getElementById('loading-indicator');
const loadingSubtext = document.getElementById('loading-subtext');
const errorMessage = document.getElementById('error-message');
const promptDisplay = document.getElementById('prompt-display');
const objectDetectionContainer = document.getElementById('object-detection-container');
const objectList = document.getElementById('object-list');
const detectionStatus = document.getElementById('detection-status');

// --- State ---
let scene, camera, renderer, textureLoader;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let panoramaMesh; 
let cocoSsdModel = null; 

// --- Initialization ---
async function init() {
    promptDisplay.textContent = `Prompt: ${INITIAL_PROMPT}`;
    showLoading("Initializing 3D scene...");

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(0, 0, 0.1);

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio); 
    container.appendChild(renderer.domElement);

    textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');

    const loadModelPromise = loadObjectDetectionModel();

    try {
        showLoading("Generating panorama image...");
        const texture = await generateAndLoadPanorama(INITIAL_PROMPT);

        showLoading("Loading object detection model...");
        await loadModelPromise;

        showLoading("Detecting objects in the scene...");
        if (texture && texture.image && cocoSsdModel) {
            await runObjectDetection(texture.image); 
        } else {
             console.warn("Skipping object detection: Model or texture image not available.");
             updateDetectionStatus("Detection skipped (model/image unavailable).", true);
        }

        hideLoading(); 

    } catch (error) {
        console.error("Initialization or generation failed:", error);
        showError(`Error: ${error.message || 'An unknown error occurred.'}`);
        return; 
    }

    setupEventListeners();

    animate();
}

// --- Loading and Error Handling ---
function showLoading(message = "Loading...") {
    loadingIndicator.style.display = 'block';
    loadingIndicator.querySelector('p').textContent = message;
    loadingSubtext.textContent = "Please wait..."; 
    errorMessage.style.display = 'none';
    objectDetectionContainer.style.display = 'none'; 
}

function updateLoadingSubtext(message) {
     loadingSubtext.textContent = message;
}

function hideLoading() {
    loadingIndicator.style.display = 'none';
}

function showError(message) {
    loadingIndicator.style.display = 'none';
    errorMessage.style.display = 'block';
    errorMessage.querySelector('p').textContent = message;
    objectDetectionContainer.style.display = 'none'; 
}


// --- Object Detection ---
async function loadObjectDetectionModel() {
    try {
        console.log("Loading COCO-SSD model...");
        await tf.setBackend('webgl');
        await tf.ready(); 
        cocoSsdModel = await cocoSsd.load();
        console.log("COCO-SSD model loaded successfully.");
    } catch (error) {
        console.error("Error loading COCO-SSD model:", error);
        updateDetectionStatus("Failed to load detection model.", true);
        cocoSsdModel = null; 
    }
}

async function runObjectDetection(imageElement) {
    if (!cocoSsdModel) {
        updateDetectionStatus("Detection model not loaded.", true);
        return;
    }
    if (!imageElement || !(imageElement instanceof HTMLImageElement)) {
        updateDetectionStatus("Invalid image for detection.", true);
        console.error("runObjectDetection requires an HTMLImageElement.");
        return;
    }

    console.log("Running object detection...");
    objectDetectionContainer.style.display = 'block'; 
    updateDetectionStatus("Detecting...");
    objectList.innerHTML = ''; 


    try {
        const predictions = await cocoSsdModel.detect(imageElement);
        console.log("Detection results:", predictions);

        if (predictions.length === 0) {
             updateDetectionStatus("No objects detected.", false);
             return;
        }

        let detectedCount = 0;
        predictions
            .filter(p => p.score >= OBJECT_DETECTION_CONFIDENCE_THRESHOLD)
            .forEach(prediction => {
                detectedCount++;
                const listItem = document.createElement('li');
                listItem.textContent = `${prediction.class}`;
                const scoreSpan = document.createElement('span');
                scoreSpan.className = 'score';
                scoreSpan.textContent = `(${(prediction.score * 100).toFixed(1)}%)`;
                listItem.appendChild(scoreSpan);
                objectList.appendChild(listItem);
            });

        if (detectedCount > 0) {
             updateDetectionStatus(`Found ${detectedCount} object(s).`, false);
        } else {
             updateDetectionStatus(`No objects detected above ${OBJECT_DETECTION_CONFIDENCE_THRESHOLD*100}% confidence.`, false);
        }

    } catch (error) {
        console.error("Error during object detection:", error);
        updateDetectionStatus("Error during detection.", true);
    }
}

function updateDetectionStatus(message, isError = false) {
    if (!detectionStatus) return;
    detectionStatus.textContent = message;
    detectionStatus.style.color = isError ? '#ff8888' : '#bbb';
     if (message && loadingIndicator.style.display === 'none' && errorMessage.style.display === 'none') {
        objectDetectionContainer.style.display = 'block';
     }
}


// --- Panorama Generation and Loading ---
async function generateAndLoadPanorama(prompt) {
    console.log("Generating image for prompt:", prompt);
    errorMessage.style.display = 'none'; 
    promptDisplay.textContent = `Prompt: ${prompt}`; 

    try {
        const imagePrompt = `${prompt}. Photorealistic equirectangular panorama 360 view, ultra high definition.`;
        console.log("Image Gen Prompt:", imagePrompt);
        updateLoadingSubtext("Waiting for image generation API...");
        const result = await websim.imageGen({
            prompt: imagePrompt,
            width: IMAGE_WIDTH,
            height: IMAGE_HEIGHT,
        });

        if (!result || !result.url) {
            throw new Error("Image generation API did not return a valid URL.");
        }
        console.log("Image generated:", result.url);
        updateLoadingSubtext("Downloading and loading texture...");

        return new Promise((resolve, reject) => {
            textureLoader.load(
                result.url,
                (texture) => {
                    console.log("Texture loaded successfully");
                    updateLoadingSubtext("Creating 3D environment...");

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

                    resolve(texture); 
                },
                undefined, 
                (error) => {
                    console.error('Error loading texture:', error);
                    reject(new Error('Failed to load panorama texture. Check browser console for details.')); 
                }
            );
        });

    } catch (error) {
        console.error("Error generating or loading image:", error);
        throw new Error(`Image Generation/Loading Failed: ${error.message}`); 
    }
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
    camera.rotation.y += yawAngle;

    const pitchAngle = -deltaY * MOUSE_SENSITIVITY;
    const maxPitch = Math.PI / 2 - 0.05; 
    const minPitch = -Math.PI / 2 + 0.05;
    camera.rotation.x += pitchAngle;
    camera.rotation.x = Math.max(minPitch, Math.min(maxPitch, camera.rotation.x));

    camera.rotation.order = 'YXZ';
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio); 
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate); 
    renderer.render(scene, camera); 
}

// --- Start ---
init().catch(err => {
    console.error("Initialization failed:", err);
    showError(`Initialization Failed: ${err.message || 'Unknown error'}`);
});