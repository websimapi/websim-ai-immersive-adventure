import * as THREE from 'three';

// --- Configuration ---
const INITIAL_PROMPT = "A futuristic cyberpunk cityscape at night, filled with towering skyscrapers adorned with vibrant, glowing neon signs and advertisements. Flying vehicles zip between buildings under a dark, rainy sky reflected in wet streets.";
const IMAGE_WIDTH = 3840;
const IMAGE_HEIGHT = 2160;
const CAMERA_FOV = 75; // Field of View
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const MOUSE_SENSITIVITY = 0.002; // Adjust for faster/slower panning
const NEON_SATURATION_THRESHOLD = 0.75; // Min saturation for neon effect
const NEON_LIGHTNESS_THRESHOLD = 0.5; // Min lightness for neon effect

// --- DOM Elements ---
const container = document.getElementById('panorama-container');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');
const promptDisplay = document.getElementById('prompt-display');
const creditsIcon = document.getElementById('credits-icon');
const creditsModal = document.getElementById('credits-modal');
const closeCreditsButton = document.getElementById('close-credits');

// --- State ---
let scene, camera, renderer, textureLoader;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let panoramaMesh; // To hold the sphere mesh
let totalYaw = Math.PI / 2; // Keep track of total horizontal rotation, START FACING LEFT
let clock = new THREE.Clock(); // Clock for time uniform
let shaderMaterial; // Material for neon effect

// --- Shader Definitions ---
const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    uniform sampler2D panoramaTexture;
    uniform float time;
    varying vec2 vUv;

    // Constants for neon detection
    const float NEON_SAT_THRESHOLD = ${NEON_SATURATION_THRESHOLD.toFixed(2)};
    const float NEON_LUM_THRESHOLD = ${NEON_LIGHTNESS_THRESHOLD.toFixed(2)};

    // --- HSL Conversion ---
    // Function to convert RGB to HSL (approximated, good enough for thresholding)
    // Returns vec3(hue, saturation, lightness)
    vec3 rgb2hsl(vec3 color) {
        float maxC = max(color.r, max(color.g, color.b));
        float minC = min(color.r, min(color.g, color.b));
        float delta = maxC - minC;
        float h = 0.0;
        float s = 0.0;
        float l = (maxC + minC) / 2.0;

        if (delta > 0.0001) { // Check against a small epsilon
            s = l > 0.5 ? delta / (2.0 - maxC - minC) : delta / (maxC + minC);
            if (maxC == color.r) {
                h = (color.g - color.b) / delta + (color.g < color.b ? 6.0 : 0.0);
            } else if (maxC == color.g) {
                h = (color.b - color.r) / delta + 2.0;
            } else { // maxC == color.b
                h = (color.r - color.g) / delta + 4.0;
            }
            h /= 6.0;
        }
        return vec3(h, s, l);
    }

    // --- Main Fragment Shader ---
    void main() {
        vec4 texColor = texture2D(panoramaTexture, vUv);
        vec3 hsl = rgb2hsl(texColor.rgb); // hsl = vec3(hue, saturation, lightness)

        // Check if the color qualifies as "neon"
        // Use .y for saturation and .z for lightness
        bool isNeon = (hsl.y >= NEON_SAT_THRESHOLD && hsl.z >= NEON_LUM_THRESHOLD);

        vec3 finalColor = texColor.rgb;

        if (isNeon) {
            // Apply a subtle pulsing/shifting effect for neon colors
            // Combine time and vertical position for variation
            // Use .x for hue
            float pulseSpeed = 2.0 + hsl.x * 3.0; // Vary speed based on hue
            float pulseIntensity = 0.05 + (hsl.y - NEON_SAT_THRESHOLD) * 0.1; // More saturated = more intense pulse
             // Use sine wave for smooth pulsing, vary phase with vertical UV and hue (.x)
            float pulse = sin(time * pulseSpeed + vUv.y * 10.0 + hsl.x * 1.5) * pulseIntensity + (1.0 - pulseIntensity * 0.5);

             // Modulate brightness
            finalColor = texColor.rgb * pulse;

             // Optional: Add a very subtle hue shift (can be performance intensive if using HSL->RGB conversion)
             // float hueShiftAmount = sin(time * 0.5 + vUv.x * 5.0) * 0.01; // Slow horizontal shift
             // vec3 shiftedHsl = vec3(mod(hsl.x + hueShiftAmount, 1.0), hsl.y, hsl.z * pulse);
             // finalColor = hsl2rgb(shiftedHsl); // Requires hsl2rgb function
        }

        gl_FragColor = vec4(finalColor, texColor.a);
    }
`;


// --- Initialization ---
async function init() {
    promptDisplay.textContent = `Prompt: ${INITIAL_PROMPT}`;

    // Scene setup
    scene = new THREE.Scene();

    // Camera setup
    camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(0, 0, 0.1);
    camera.rotation.order = 'YXZ'; // Set rotation order early
    camera.rotation.y = totalYaw; // Start camera facing 90 degrees left

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
                        // ShaderMaterial handles its own texture disposal? Check docs.
                        // For safety, dispose the texture if the material exists and has a map uniform
                        if (shaderMaterial && shaderMaterial.uniforms.panoramaTexture.value) {
                             shaderMaterial.uniforms.panoramaTexture.value.dispose();
                        }
                         if (shaderMaterial) shaderMaterial.dispose(); // Dispose material
                    }

                    // Create sphere geometry (large radius, inside-out)
                    const geometry = new THREE.SphereGeometry(500, 60, 40); // Radius, width segments, height segments
                    geometry.scale(-1, 1, 1);

                    // --- Create Shader Material ---
                    shaderMaterial = new THREE.ShaderMaterial({
                        uniforms: {
                            time: { value: 0.0 },
                            panoramaTexture: { value: texture }
                        },
                        vertexShader: vertexShader,
                        fragmentShader: fragmentShader,
                        side: THREE.BackSide // Render the inside of the sphere
                    });

                    // Create mesh and add to scene
                    panoramaMesh = new THREE.Mesh(geometry, shaderMaterial);
                    scene.add(panoramaMesh);

                    loadingIndicator.style.display = 'none'; // Hide loading
                    resolve(); // Resolve the promise when texture is loaded
                },
                undefined, // onProgress callback (optional)
                (error) => {
                    console.error('Error loading texture:', error);
                    loadingIndicator.style.display = 'none';
                    errorMessage.style.display = 'block';
                    errorMessage.querySelector('p').textContent = 'Error loading panorama image. Please check the console for details.';
                    reject(new Error('Failed to load panorama texture.')); // Reject the promise on error
                }
            );
        });

    } catch (error) {
        console.error("Error generating image:", error);
        loadingIndicator.style.display = 'none';
        errorMessage.style.display = 'block';
        errorMessage.querySelector('p').textContent = `Error generating image: ${error.message || 'Unknown error'}`;
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

    // Credits UI Listeners (Check if elements exist before adding listeners)
    if (creditsIcon) creditsIcon.addEventListener('click', openCredits);
    if (closeCreditsButton) closeCreditsButton.addEventListener('click', closeCredits);
}

function getClientPosition(event) {
    if (event.touches && event.touches.length > 0) { // Check length too
        return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else {
        return { x: event.clientX, y: event.clientY };
    }
}

function onPointerDown(event) {
    // Check if clicking inside the credits modal
    if (creditsModal && creditsModal.style.display !== 'none' && creditsModal.contains(event.target)) {
        return; // Don't start dragging if clicking inside the modal
    }
     // Check if clicking the credits icon
     if (creditsIcon && creditsIcon.contains(event.target)) {
         return; // Don't start dragging if clicking the icon
     }


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
    // Calculate potential new total yaw relative to the initial offset
    const potentialYaw = totalYaw + yawAngle;

    // Define yaw limits relative to the starting angle (+/- 100 degrees from the start)
    // Start angle is Math.PI / 2
    const startAngle = Math.PI / 2;
    const yawLimitRange = (100 * Math.PI) / 180; // +/- 100 degrees in radians
    const minYaw = startAngle - yawLimitRange;
    const maxYaw = startAngle + yawLimitRange;

    // Clamp the total yaw
    totalYaw = Math.max(minYaw, Math.min(maxYaw, potentialYaw));

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

// --- Credits UI Functions ---
function openCredits() {
    if (creditsModal) creditsModal.style.display = 'block';
}

function closeCredits() {
     if (creditsModal) creditsModal.style.display = 'none';
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate); // Request next frame

    // Update shader time uniform if the material exists
    if (shaderMaterial) {
        shaderMaterial.uniforms.time.value = clock.getElapsedTime();
    }

    renderer.render(scene, camera); // Render the scene
}

// --- Start ---
init().catch(err => {
    console.error("Initialization failed in catch block:", err);
    // Ensure loading is hidden and error is shown even if init promise rejects late
    loadingIndicator.style.display = 'none';
    errorMessage.style.display = 'block';
    errorMessage.querySelector('p').textContent = `Initialization Error: ${err.message || 'An unknown error occurred.'}`;
});