// --- Shader Definitions ---

export const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// --- Constants for Neon Effect ---
// Lower these slightly if detection misses some neon, raise if non-neon gets affected
const NEON_SAT_THRESHOLD = 0.65; // Based on HSV Saturation
const NEON_VAL_THRESHOLD = 0.70; // Based on HSV Value (Brightness)

// --- Enhanced Fragment Shader for Smoother Neon Effects ---
export const fragmentShader = `
    uniform sampler2D panoramaTexture;
    uniform float time;
    varying vec2 vUv;

    // --- Constants ---
    const float NEON_SAT_THRESHOLD = ${NEON_SAT_THRESHOLD.toFixed(2)};
    const float NEON_VAL_THRESHOLD = ${NEON_VAL_THRESHOLD.toFixed(2)};
    const float PI = 3.14159265359;

    // --- RGB to HSV Conversion ---
    // Input: vec3 color (r, g, b) in [0, 1]
    // Output: vec3(hue[0,1], saturation[0,1], value[0,1])
    vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10; // Epsilon to prevent division by zero
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    // --- HSV to RGB Conversion (Optional, useful for debugging/effects) ---
    // vec3 hsv2rgb(vec3 c) {
    //     vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    //     vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    //     return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    // }

    // --- Noise function (Simple 2D hash) ---
    // Provides pseudo-random values based on input coordinates
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // --- Smooth Noise (Value Noise) ---
    // Interpolates between random values at grid points
    float noise(vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);

        // Four corners in 2D of a tile
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));

        // Smooth interpolation (cubic)
        vec2 u = f * f * (3.0 - 2.0 * f);
        // vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // Smootherstep

        // Mix top and bottom edges, then mix results
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }


    // --- Main Fragment Shader ---
    void main() {
        vec2 baseUv = vUv;
        vec4 texColor = texture2D(panoramaTexture, baseUv);

        // Early exit for transparent pixels (unlikely needed for panorama)
        // if (texColor.a < 0.1) discard;

        vec3 hsv = rgb2hsv(texColor.rgb); // Use HSV for better brightness/saturation detection

        // --- Neon Detection ---
        // Use Saturation (hsv.y) and Value (hsv.z)
        bool isNeonCandidate = (hsv.y >= NEON_SAT_THRESHOLD && hsv.z >= NEON_VAL_THRESHOLD);

        // Optional: Hue constraint (e.g., exclude certain yellows/oranges if desired)
        // float hue = hsv.x;
        // bool hueIsNeon = (hue < 0.1 || hue > 0.9) || (hue > 0.25 && hue < 0.75); // Example: Reds, Pinks, Blues, Greens, Cyans
        // bool isNeon = isNeonCandidate && hueIsNeon;
        bool isNeon = isNeonCandidate; // Use candidate directly for broader detection

        vec3 finalColor = texColor.rgb;

        if (isNeon) {
            // --- 1. Calculate Intensity Factor ---
            // How strongly "neon" the color is, based on exceeding thresholds.
            float satFactor = smoothstep(NEON_SAT_THRESHOLD, NEON_SAT_THRESHOLD + 0.2, hsv.y); // Range 0.2
            float valFactor = smoothstep(NEON_VAL_THRESHOLD, NEON_VAL_THRESHOLD + 0.2, hsv.z); // Range 0.2
            float neonIntensity = clamp(satFactor * valFactor, 0.0, 1.0); // Combine factors

            // --- 2. Fluid Brightness Pulse ---
            // Use multiple layers of noise and sine waves for more complex movement
            float timeScaled = time * 0.6; // Slow down base time

            // Layer 1: Slow, large scale variation using noise
            float noiseVal1 = noise(baseUv * 5.0 + timeScaled * 0.1 + hsv.x * 1.5); // Scale 5, slow time, hue influences phase
            // Layer 2: Faster, smaller scale variation using sine
            float pulseSpeed = 1.8 + hsv.x * 3.0; // Hue affects speed
            float sinVal = sin(time * pulseSpeed + baseUv.y * 15.0 + hsv.x * PI * 2.0); // Time, UV.y, Hue based sine wave

            // Combine noise and sine for brightness modulation
            // noiseVal1 ranges roughly [0, 1], sinVal ranges [-1, 1]
            float combinedPulse = mix(sinVal, noiseVal1 * 2.0 - 1.0, 0.4); // Blend sine and scaled noise
            float pulseMagnitude = (0.05 + neonIntensity * 0.20) * (0.7 + noise(baseUv * 30.0 + timeScaled) * 0.6); // Intensity + small noise variation
            pulseMagnitude = clamp(pulseMagnitude, 0.0, 0.25); // Clamp max brightness boost/dip

            float brightnessMultiplier = 1.0 + combinedPulse * pulseMagnitude;
            // Ensure brightness doesn't dip too low
            brightnessMultiplier = max(1.0 - pulseMagnitude * 0.7, brightnessMultiplier);

            finalColor = texColor.rgb * brightnessMultiplier; // Apply brightness pulse

            // --- 3. Subtle Fluid Distortion/Wiggle ---
            // Use noise to drive small UV offsets
            float distortNoiseScale = 15.0; // Noise frequency for distortion
            float distortTimeScale = 0.3;
            float distortMagnitudeBase = 0.0005; // Max distortion amount
            float distortIntensityFactor = neonIntensity * neonIntensity; // Stronger effect for more intense neon

            // Get two noise values at different time offsets for x/y movement
            float noiseX = noise(baseUv * distortNoiseScale + vec2(time * distortTimeScale, 0.0)); // Noise value for X offset
            float noiseY = noise(baseUv * distortNoiseScale + vec2(0.0, time * distortTimeScale + 0.5)); // Noise value for Y offset (different phase)

            // Map noise [0,1] to offset [-1, 1] and scale by magnitude
            float offsetX = (noiseX * 2.0 - 1.0) * distortMagnitudeBase * distortIntensityFactor;
            float offsetY = (noiseY * 2.0 - 1.0) * distortMagnitudeBase * distortIntensityFactor;

            // Sample texture at distorted UV, apply same brightness multiplier for consistency
            vec3 distortedColor = texture2D(panoramaTexture, baseUv + vec2(offsetX, offsetY)).rgb * brightnessMultiplier;

            // --- 4. Blend Original Pulsed and Distorted Colors ---
            // Blend based on neon intensity for a shimmer effect
            float blendFactor = smoothstep(0.1, 0.8, neonIntensity) * 0.5; // Blend more as intensity increases, max 50%
            finalColor = mix(finalColor, distortedColor, blendFactor);

            // --- 5. Optional: Subtle Additive Bloom/Glow ---
            // Add a bit of the color back to itself, scaled by intensity and pulse
            // Keep this very subtle to avoid over-brightening
            float glowAmount = neonIntensity * max(0.0, combinedPulse) * 0.08; // Glow stronger on bright part of pulse
            finalColor += finalColor * glowAmount;
        }

        // Final output: Clamp color values to [0, 1] range and preserve original alpha
        gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), texColor.a);
    }
`;