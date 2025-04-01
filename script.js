import * as THREE from 'three';

// --- Configuration ---
const INITIAL_PROMPT = "A futuristic cyberpunk cityscape at night, filled with towering skyscrapers adorned with vibrant, glowing neon signs and advertisements. Flying vehicles zip between buildings under a dark, rainy sky reflected in wet streets.";
const IMAGE_WIDTH = 3840;
const IMAGE_HEIGHT = 2160;
const CAMERA_FOV = 75; // Field of View
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const MOUSE_SENSITIVITY = 0.002; // Adjust for faster/slower panning
const NEON_SATURATION_THRESHOLD = 0.70; // Lowered slightly to catch more colors
const NEON_LIGHTNESS_THRESHOLD = 0.45; // Lowered slightly

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

// --- Enhanced Fragment Shader for Neon Effects ---
const fragmentShader = `
    uniform sampler2D panoramaTexture;
    uniform float time;
    varying vec2 vUv;

    // Constants for neon detection
    const float NEON_SAT_THRESHOLD = ${NEON_SATURATION_THRESHOLD.toFixed(2)};
    const float NEON_LUM_THRESHOLD = ${NEON_LIGHTNESS_THRESHOLD.toFixed(2)};

    // --- HSL Conversion ---
    // Function to convert RGB to HSL (approximated)
    // Returns vec3(hue, saturation, lightness) -> (x, y, z)
    vec3 rgb2hsl(vec3 color) {
        float maxC = max(color.r, max(color.g, color.b));
        float minC = min(color.r, min(color.g, color.b));
        float delta = maxC - minC;
        float h = 0.0;
        float s = 0.0;
        float l = (maxC + minC) / 2.0;

        if (delta > 0.0001) { // Check against a small epsilon
            // Calculate saturation
            s = l > 0.5 ? delta / (2.0 - maxC - minC) : delta / (maxC + minC);

            // Calculate hue (denominator 'delta' is > 0.0001 here)
            if (maxC == color.r) {
                h = (color.g - color.b) / delta + (color.g < color.b ? 6.0 : 0.0);
            } else if (maxC == color.g) {
                h = (color.b - color.r) / delta + 2.0;
            } else { // maxC == color.b
                h = (color.r - color.g) / delta + 4.0;
            }
            h /= 6.0; // Normalize hue to [0, 1]
        }
        // Clamp saturation for safety
        s = clamp(s, 0.0, 1.0);
        return vec3(h, s, l);
    }

    // --- Noise function (Simple 2D hash) ---
    // Provides pseudo-random values based on input coordinates
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // --- Main Fragment Shader ---
    void main() {
        vec2 baseUv = vUv;
        vec4 texColor = texture2D(panoramaTexture, baseUv);

        // Early exit for transparent pixels if needed (unlikely for panorama)
        // if (texColor.a < 0.1) discard;

        vec3 hsl = rgb2hsl(texColor.rgb); // hsl = vec3(hue, saturation, lightness) -> (x, y, z)

        // Check if the color qualifies as "neon" using thresholds
        // Using .y for saturation and .z for lightness
        bool isNeon = (hsl.y >= NEON_SAT_THRESHOLD && hsl.z >= NEON_LUM_THRESHOLD);

        vec3 finalColor = texColor.rgb;

        if (isNeon) {
            // --- 1. Calculate Intensity Factors ---
            // How much it exceeds thresholds (smoothly transitioning from 0 to 1)
            float satFactor = smoothstep(NEON_SAT_THRESHOLD, NEON_SAT_THRESHOLD + 0.15, hsl.y); // Gradual increase over 0.15 saturation range
            float lumFactor = smoothstep(NEON_LUM_THRESHOLD, NEON_LUM_THRESHOLD + 0.25, hsl.z); // Gradual increase over 0.25 lightness range
            // Combine factors, weighting saturation more
            float neonIntensity = clamp(satFactor * 0.7 + lumFactor * 0.3, 0.0, 1.0);

            // --- 2. Brightness Pulse ---
            float pulseSpeed = 1.5 + hsl.x * 4.0 + neonIntensity * 2.5; // Base speed + hue variation + intensity boost
            float pulseMagnitude = 0.08 + neonIntensity * 0.22; // Base magnitude + intensity contribution, max ~0.3
            pulseMagnitude = clamp(pulseMagnitude, 0.05, 0.3); // Clamp magnitude range

            // Noise for spatial variation in pulse phase/speed - use a grid
            vec2 noiseCoord = floor(baseUv * vec2(60.0, 30.0)) / vec2(60.0, 30.0); // Coarser noise grid
            float noiseVal = random(noiseCoord + floor(time * 2.0)); // Noise changes slowly over time

            // Base pulse wave using sine
            float pulseWave = sin(time * pulseSpeed + baseUv.y * 12.0 + hsl.x * 3.14 + noiseVal * 6.28); // Ranges [-1, 1]

            // Modulate brightness: 1.0 = base, +/- pulseMagnitude
            float brightnessMultiplier = 1.0 + pulseWave * pulseMagnitude;
            // Ensure minimum brightness to avoid black spots
            brightnessMultiplier = max(1.0 - pulseMagnitude * 0.8, brightnessMultiplier); // Allow dimming but not too much

            // Apply brightness pulse to the original color
            vec3 pulsedColor = texColor.rgb * brightnessMultiplier;

            // --- 3. Subtle Distortion/Wiggle ---
            // Use time and noise to create a small offset in texture coordinates
            float distortSpeed = 1.0 + noiseVal * 1.5 + neonIntensity * 1.0;
            // Make distortion stronger based on intensity but keep it small overall
            float distortMagnitude = (0.0003 + neonIntensity * 0.001) * (0.8 + noiseVal * 0.4); // Base + intensity + noise modulation
            distortMagnitude = clamp(distortMagnitude, 0.0, 0.0015); // Clamp max distortion

            // Calculate offset using sine/cosine for wave-like motion
            float offsetX = sin(time * distortSpeed + baseUv.y * 25.0 + noiseVal * 5.0) * distortMagnitude;
            float offsetY = cos(time * distortSpeed * 0.7 + baseUv.x * 25.0 + noiseVal * 8.0) * distortMagnitude;

            // Sample texture again with distorted UVs
            // Use the brightness multiplier on the distorted sample too, for consistency
            vec3 distortedColor = texture2D(panoramaTexture, baseUv + vec2(offsetX, offsetY)).rgb * brightnessMultiplier;

            // Blend the pulsed color with the distorted sample for a shimmer/movement effect
            // Blend amount increases with neon intensity
            float blendFactor = neonIntensity * (0.3 + noiseVal * 0.3); // Base blend + noise variation
            finalColor = mix(pulsedColor, distortedColor, clamp(blendFactor, 0.0, 0.6)); // Mix based on intensity/noise, max 60% distorted

            // --- 4. Additive Glow (Optional & Subtle) ---
            // Enhance brightness slightly, especially when the pulse is high
            float glowAmount = neonIntensity * max(0.0, pulseWave) * 0.1; // Glow only on the bright part of the pulse
            finalColor += finalColor * glowAmount; // Additive glow based on current color and intensity
        }

        // Final output: Clamp color values to [0, 1] range and preserve original alpha
        gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), texColor.a);
    }
`;


// --- Initialization ---
async function init() {
    promptDisplay.textContent = `Prompt: ${INITIAL_PROMPT}`;

    // Scene setup
    scene = new THREE.Scene();

    // Camera setup
    camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(0, 0, 0.1); // Set a small z offset to ensure camera is *inside* the sphere
    camera.rotation.order = 'YXZ'; // Use YXZ order for intuitive yaw/pitch control
    camera.rotation.y = totalYaw; // Start camera facing 90 degrees left

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true }); // Enable antialiasing
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
                        // Dispose old material and texture first
                         if (shaderMaterial) {
                             if (shaderMaterial.uniforms.panoramaTexture.value) {
                                 shaderMaterial.uniforms.panoramaTexture.value.dispose();
                             }
                             shaderMaterial.dispose();
                         }
                         // Then remove mesh and dispose geometry
                        scene.remove(panoramaMesh);
                        panoramaMesh.geometry.dispose();
                        panoramaMesh = null; // Clear reference
                    }

                    // Create sphere geometry (large radius, inside-out)
                    const geometry = new THREE.SphereGeometry(500, 64, 32); // Increased segments slightly
                    geometry.scale(-1, 1, 1); // Invert geometry normals so inside is visible

                    // --- Create Shader Material ---
                    shaderMaterial = new THREE.ShaderMaterial({
                        uniforms: {
                            time: { value: 0.0 },
                            panoramaTexture: { value: texture }
                        },
                        vertexShader: vertexShader,
                        fragmentShader: fragmentShader, // Use the new enhanced shader
                        side: THREE.DoubleSide // Use DoubleSide for safety
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

    // Credits UI Listeners
    if (creditsIcon) creditsIcon.addEventListener('click', openCredits);
    if (closeCreditsButton) closeCreditsButton.addEventListener('click', closeCredits);
    // Optional: Close modal if clicking outside of it
    document.addEventListener('click', (event) => {
      if (creditsModal && creditsModal.style.display === 'block' && !creditsModal.contains(event.target) && event.target !== creditsIcon) {
         closeCredits();
      }
    });
}

function getClientPosition(event) {
    if (event.touches && event.touches.length > 0) {
        return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else {
        return { x: event.clientX, y: event.clientY };
    }
}

function onPointerDown(event) {
    // Ignore if clicking inside the modal or on the icon
    if ((creditsModal && creditsModal.contains(event.target)) || (creditsIcon && creditsIcon.contains(event.target))) {
        return;
    }

    // Check if it's the primary button for mouse or single touch
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
    // Calculate rotation angles based on pointer movement
    const yawAngle = -deltaX * MOUSE_SENSITIVITY;
    const pitchAngle = -deltaY * MOUSE_SENSITIVITY;

    // Apply yaw (horizontal) rotation
    camera.rotation.y += yawAngle;

    // Apply pitch (vertical) rotation and clamp it
    const maxPitch = Math.PI / 2 - 0.1; // Slightly less than 90 degrees
    const minPitch = -Math.PI / 2 + 0.1;
    camera.rotation.x += pitchAngle;
    camera.rotation.x = Math.max(minPitch, Math.min(maxPitch, camera.rotation.x));

    // No need for quaternion conversion since we're using Euler order 'YXZ'
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
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

    // Update shader time uniform if the material and uniform exist
    if (shaderMaterial && shaderMaterial.uniforms.time) {
        shaderMaterial.uniforms.time.value = clock.getElapsedTime();
    }

    // Ensure scene and camera exist before rendering
    if(scene && camera) {
        renderer.render(scene, camera); // Render the scene
    } else {
        // Don't log excessively if just waiting for init
        // console.warn("Scene or Camera not ready for rendering.");
    }
}

// --- Start ---
init().catch(err => {
    console.error("Initialization failed:", err);
    // Ensure loading is hidden and error is shown
    loadingIndicator.style.display = 'none';
    errorMessage.style.display = 'block';
    errorMessage.querySelector('p').textContent = `Initialization Error: ${err.message || 'An unknown error occurred.'}`;
});