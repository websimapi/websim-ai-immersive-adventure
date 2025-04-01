import * as THREE from 'three';

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
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');
const promptDisplay = document.getElementById('prompt-display');

// --- State ---
let scene, camera, renderer, textureLoader;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let panoramaMesh; // To hold the sphere mesh
let totalYaw = 0; // Keep track of total horizontal rotation

// --- Initialization ---
async function init() {
    promptDisplay.textContent = `Prompt: ${INITIAL_PROMPT}`;

    // Scene setup
    scene = new THREE.Scene();

    // Camera setup
    camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    // Position camera slightly forward; it will look at the center by default.
    // We rotate the camera itself, not move it around.
    camera.position.set(0, 0, 0.1);
    camera.rotation.order = 'YXZ'; // Set rotation order early

    // Renderer setup
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio); // Adjust for high-DPI displays
    container.appendChild(renderer.domElement);

    // Texture Loader
    textureLoader = new THREE.TextureLoader();

    try {
        // Generate initial panorama
        await generateAndLoadPanorama(INITIAL_PROMPT);
        loadingIndicator.style.display = 'none'; // Hide loading indicator
    } catch (error) {
        console.error("Initialization failed:", error);
        loadingIndicator.style.display = 'none'; // Hide loading indicator
        errorMessage.style.display = 'block'; // Show error message
        errorMessage.querySelector('p').textContent = `Error: ${error.message || 'An unknown error occurred during initialization.'}`;
        return; // Stop initialization if generation fails
    }

    // Event Listeners
    setupEventListeners();

    // Start animation loop
    animate();
}

// --- Panorama Generation and Loading ---
async function generateAndLoadPanorama(prompt) {
    console.log("Generating image for prompt:", prompt);
    loadingIndicator.style.display = 'block'; // Show loading
    errorMessage.style.display = 'none'; // Hide error
    promptDisplay.textContent = `Prompt: ${prompt}`; // Update display

    try {
        const imagePrompt = `${prompt}. Photorealistic equirectangular panorama 360 view, ultra high definition.`;
        console.log("Image Gen Prompt:", imagePrompt);
        const result = await websim.imageGen({
            prompt: imagePrompt,
            width: IMAGE_WIDTH,
            height: IMAGE_HEIGHT,
        });

        console.log("Image generated:", result.url);

        return new Promise((resolve, reject) => {
            textureLoader.load(
                result.url,
                (texture) => {
                    console.log("Texture loaded successfully");

                    // Ensure texture wraps correctly for a sphere
                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    texture.colorSpace = THREE.SRGBColorSpace; // Important for correct colors

                    // Remove previous panorama if it exists
                    if (panoramaMesh) {
                        scene.remove(panoramaMesh);
                        panoramaMesh.geometry.dispose();
                        if (panoramaMesh.material.map) panoramaMesh.material.map.dispose(); // Dispose texture
                        panoramaMesh.material.dispose(); // Dispose material
                    }

                    // Create sphere geometry (large radius, inside-out)
                    // Use a large radius so the camera is effectively at the center
                    const geometry = new THREE.SphereGeometry(500, 60, 40); // Radius, width segments, height segments
                    // Invert the geometry on the x-axis so that the faces point inward
                    geometry.scale(-1, 1, 1);

                    // Create material with the loaded texture
                    // Use MeshBasicMaterial as lighting is baked into the texture
                    const material = new THREE.MeshBasicMaterial({ map: texture });

                    // Create mesh and add to scene
                    panoramaMesh = new THREE.Mesh(geometry, material);
                    scene.add(panoramaMesh);

                    loadingIndicator.style.display = 'none'; // Hide loading
                    resolve(); // Resolve the promise when texture is loaded
                },
                undefined, // onProgress callback (optional)
                (error) => {
                    console.error('Error loading texture:', error);
                    loadingIndicator.style.display = 'none';
                    errorMessage.style.display = 'block';
                    reject(new Error('Failed to load panorama texture.')); // Reject the promise on error
                }
            );
        });

    } catch (error) {
        console.error("Error generating image:", error);
        loadingIndicator.style.display = 'none';
        errorMessage.style.display = 'block';
        throw new Error('Failed to generate panorama image.'); // Re-throw specific error
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    // Mouse controls
    container.addEventListener('mousedown', onPointerDown);
    container.addEventListener('mousemove', onPointerMove);
    container.addEventListener('mouseup', onPointerUp);
    container.addEventListener('mouseleave', onPointerUp); // Stop dragging if mouse leaves container

    // Touch controls (use pointer events for simplicity)
    container.addEventListener('touchstart', onPointerDown, { passive: false });
    container.addEventListener('touchmove', onPointerMove, { passive: false });
    container.addEventListener('touchend', onPointerUp);
    container.addEventListener('touchcancel', onPointerUp);

    // Window resize
    window.addEventListener('resize', onWindowResize);
}

function getClientPosition(event) {
    if (event.touches && event.touches.length > 0) { // Check length too
        return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else {
        return { x: event.clientX, y: event.clientY };
    }
}

function onPointerDown(event) {
    // Check if it's the primary button for mouse or single touch
    if ((event.button && event.button !== 0) && !event.touches) return; // Ignore right/middle clicks
    if (event.touches && event.touches.length > 1) return; // Ignore multi-touch gestures for now

    isDragging = true;
    const pos = getClientPosition(event);
    previousMousePosition.x = pos.x;
    previousMousePosition.y = pos.y;
    container.style.cursor = 'grabbing'; // Change cursor

    // Prevent default behavior like text selection or page scrolling on touch
    if (event.touches) event.preventDefault();
}

function onPointerMove(event) {
    if (!isDragging) return;
    // Prevent scrolling while dragging on touch devices
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
    container.style.cursor = 'grab'; // Restore cursor
}

function rotateCamera(deltaX, deltaY) {
    // Calculate rotation angles based on pointer movement
    const yawAngle = -deltaX * MOUSE_SENSITIVITY;
    const pitchAngle = -deltaY * MOUSE_SENSITIVITY;

    // --- Yaw (Horizontal Rotation) ---
    // Calculate potential new total yaw
    const potentialYaw = totalYaw + yawAngle;

    // Define yaw limits (200 degrees total = +/- 100 degrees from center)
    const yawLimit = (100 * Math.PI) / 180; // +/- 100 degrees in radians

    // Clamp the total yaw
    totalYaw = Math.max(-yawLimit, Math.min(yawLimit, potentialYaw));

    // Apply the clamped yaw to the camera
    camera.rotation.y = totalYaw;


    // --- Pitch (Vertical Rotation) ---
    // Apply pitch rotation directly to camera's x rotation and clamp it
    const maxPitch = Math.PI / 2 - 0.05; // Limit to slightly less than 90 degrees up/down
    const minPitch = -Math.PI / 2 + 0.05;
    camera.rotation.x += pitchAngle;
    camera.rotation.x = Math.max(minPitch, Math.min(maxPitch, camera.rotation.x));

    // Rotation order 'YXZ' is already set in init()
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio); // Update pixel ratio on resize too
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate); // Request next frame

    // No manual updates needed here if controls directly modify camera rotation

    renderer.render(scene, camera); // Render the scene
}

// --- Start ---
init().catch(err => {
    console.error("Initialization failed in catch block:", err);
    // Ensure loading is hidden and error is shown even if init promise rejects late
    loadingIndicator.style.display = 'none';
    errorMessage.style.display = 'block';
    errorMessage.querySelector('p').textContent = `Error: ${err.message || 'An unknown error occurred during initialization.'}`;
});