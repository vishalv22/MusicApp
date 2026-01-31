// NCS-style audio visualizer overlay adapted from spicetify-visualizer.
// Renders a WebGL2 particle/dot field and drives it via real-time audio amplitude.

(function () {
    const PARTICLE_VERT_SHADER = `#version 300 es

in vec2 inPosition;
out vec2 fragUV;

void main() {
    gl_Position = vec4(inPosition, 0.0, 1.0);
    fragUV = (inPosition + 1.0) / 2.0;
}
`;

    const PARTICLE_FRAG_SHADER = `#version 300 es
precision highp float;

uniform float uNoiseOffset;
uniform float uAmplitude;
uniform int uSeed;

uniform float uDotSpacing;
uniform float uDotOffset;

uniform float uSphereRadius;
uniform float uFeather;

uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;

in vec2 fragUV;
out vec2 outColor;

// https://github.com/Auburn/FastNoiseLite

const float FREQUENCY = 0.01;

const float GAIN = 0.5;
const float LACUNARITY = 1.5;
const float FRACTAL_BOUNDING = 1.0 / 1.75;

const ivec3 PRIMES = ivec3(501125321, 1136930381, 1720413743);

const float GRADIENTS_3D[] = float[](
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    0., 1., 1., 0.,  0.,-1., 1., 0.,  0., 1.,-1., 0.,  0.,-1.,-1., 0.,
    1., 0., 1., 0., -1., 0., 1., 0.,  1., 0.,-1., 0., -1., 0.,-1., 0.,
    1., 1., 0., 0., -1., 1., 0., 0.,  1.,-1., 0., 0., -1.,-1., 0., 0.,
    1., 1., 0., 0.,  0.,-1., 1., 0., -1., 1., 0., 0.,  0.,-1.,-1., 0.
);

float smootherStep(float t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
vec3 smootherStep(vec3 coord) {
    return vec3(smootherStep(coord.x), smootherStep(coord.y), smootherStep(coord.z));
}

int hash(int seed, ivec3 primed) {
    return (seed ^ primed.x ^ primed.y ^ primed.z) * 0x27d4eb2d;
}

float gradCoord(int seed, ivec3 primed, vec3 d) {
    int hash = hash(seed, primed);
    hash ^= hash >> 15;
    hash &= 63 << 2;
    return d.x * GRADIENTS_3D[hash] + d.y * GRADIENTS_3D[hash | 1] + d.z * GRADIENTS_3D[hash | 2];
}

float perlinSingle(int seed, vec3 coord) {
    ivec3 coord0 = ivec3(floor(coord));
    vec3 d0 = coord - vec3(coord0);
    vec3 d1 = d0 - 1.0;
    vec3 s = smootherStep(d0);
    coord0 *= PRIMES;
    ivec3 coord1 = coord0 + PRIMES;
    float xf00 = mix(gradCoord(seed,                              coord0,                     d0), gradCoord(seed,          ivec3(coord1.x, coord0.yz),      vec3(d1.x, d0.yz)), s.x);
    float xf10 = mix(gradCoord(seed, ivec3(coord0.x, coord1.y, coord0.z), vec3(d0.x, d1.y, d0.z)), gradCoord(seed,          ivec3(coord1.xy, coord0.z),      vec3(d1.xy, d0.z)), s.x);
    float xf01 = mix(gradCoord(seed,          ivec3(coord0.xy, coord1.z),      vec3(d0.xy, d1.z)), gradCoord(seed, ivec3(coord1.x, coord0.y, coord1.z), vec3(d1.x, d0.y, d1.z)), s.x);
    float xf11 = mix(gradCoord(seed,          ivec3(coord0.x, coord1.yz),      vec3(d0.x, d1.yz)), gradCoord(seed,                              coord1,                     d1), s.x);
    float yf0 = mix(xf00, xf10, s.y);
    float yf1 = mix(xf01, xf11, s.y);
    return mix(yf0, yf1, s.z) * 0.964921414852142333984375f;
}

float fractalNoise(vec3 coord) {
    return perlinSingle(uSeed, coord) * FRACTAL_BOUNDING
        + perlinSingle(uSeed + 1, coord * LACUNARITY) * FRACTAL_BOUNDING * GAIN
        + perlinSingle(uSeed + 2, coord * LACUNARITY * LACUNARITY) * FRACTAL_BOUNDING * GAIN * GAIN;
}

void main() {
    float noise = fractalNoise(vec3(fragUV * uNoiseFrequency, uNoiseOffset)) * uNoiseAmplitude;
    vec3 dotCenter = vec3(fragUV * uDotSpacing + uDotOffset + noise, (noise + 0.5 * uNoiseAmplitude) * uAmplitude * 0.4);
    
    float distanceFromCenter = length(dotCenter);
    dotCenter /= distanceFromCenter;
    distanceFromCenter = min(uSphereRadius, distanceFromCenter);
    dotCenter *= distanceFromCenter;

    float featherRadius = uSphereRadius - uFeather;
    float featherStrength = 1.0 - clamp((distanceFromCenter - featherRadius) / uFeather, 0.0, 1.0);
    dotCenter *= featherStrength * (uSphereRadius / distanceFromCenter - 1.0) + 1.0;

    dotCenter.y *= -1.0;
    outColor = dotCenter.xy;
}
`;

    const DOT_VERT_SHADER = `#version 300 es

uniform int uDotCount;
uniform float uDotRadius;
uniform float uDotRadiusPX;

uniform sampler2D uParticleTexture;

in vec2 inPosition;

out vec2 fragUV;
out float fragDotRadiusPX;

void main() {
    ivec2 dotIndex = ivec2(gl_InstanceID % uDotCount, gl_InstanceID / uDotCount);
    vec2 dotCenter = texelFetch(uParticleTexture, dotIndex, 0).xy;

    gl_Position = vec4(dotCenter + inPosition * uDotRadius * (1.0 + 1.0 / uDotRadiusPX), 0.0, 1.0);
    fragUV = inPosition;
    fragDotRadiusPX = uDotRadiusPX + 1.0;
}
`;

    const DOT_FRAG_SHADER = `#version 300 es
precision highp float;

in vec2 fragUV;
in float fragDotRadiusPX;
out float outColor;

void main() {
    float t = clamp((1.0 - length(fragUV)) * fragDotRadiusPX, 0.0, 1.0);
    outColor = t;
}
`;

    const BLUR_VERT_SHADER = `#version 300 es

uniform float uBlurRadius;
uniform vec2 uBlurDirection;

in vec2 inPosition;

out vec2 fragUV;
flat out vec2 fragBlurDirection;
flat out int fragSupport;
flat out vec3 fragGaussCoefficients;

float calculateGaussianTotal(int support, vec3 fragGaussCoefficients) {
    float total = fragGaussCoefficients.x;
    for (int i = 1; i < support; i++) {
        fragGaussCoefficients.xy *= fragGaussCoefficients.yz;
        total += 2.0 * fragGaussCoefficients.x;
    }
    return total;
}

void main() {
    fragSupport = int(ceil(1.5 * uBlurRadius)) * 2;
    fragGaussCoefficients = vec3(1.0 / (sqrt(2.0 * 3.14159265) * uBlurRadius), exp(-0.5 / (uBlurRadius * uBlurRadius)), 0.0);
    fragGaussCoefficients.z = fragGaussCoefficients.y * fragGaussCoefficients.y;
    fragGaussCoefficients.x /= calculateGaussianTotal(fragSupport, fragGaussCoefficients);

    gl_Position = vec4(inPosition, 0.0, 1.0);
    fragUV = (inPosition + 1.0) / 2.0;
    fragBlurDirection = uBlurDirection;
}
`;

    const BLUR_FRAG_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uInputTexture;

in vec2 fragUV;
flat in vec2 fragBlurDirection;
flat in int fragSupport;
flat in vec3 fragGaussCoefficients;

out float outColor;

void main() {
    vec3 gaussCoefficients = fragGaussCoefficients;
    outColor = gaussCoefficients.x * texture(uInputTexture, fragUV).r;

    for (int i = 1; i < fragSupport; i += 2) {
        gaussCoefficients.xy *= gaussCoefficients.yz;
        float coefficientSum = gaussCoefficients.x;
        gaussCoefficients.xy *= gaussCoefficients.yz;
        coefficientSum += gaussCoefficients.x;

        float pixelRatio = gaussCoefficients.x / coefficientSum;
        vec2 offset = (float(i) + pixelRatio) * fragBlurDirection;

        outColor += coefficientSum * (texture(uInputTexture, fragUV + offset).r + texture(uInputTexture, fragUV - offset).r);
    }
}
`;

    const FINALIZE_VERT_SHADER = `#version 300 es

uniform vec3 uOutputColor;
in vec2 inPosition;

out vec2 fragUV;
out vec3 fragOutputColor;

void main() {
    gl_Position = vec4(inPosition, 0.0, 1.0);
    fragUV = (inPosition + 1.0) / 2.0;
    fragOutputColor = uOutputColor;
}
`;

    const FINALIZE_FRAG_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uBlurredTexture;
uniform sampler2D uOriginalTexture;

in vec2 fragUV;
in vec3 fragOutputColor;

out vec4 outColor;

void main() {
    float value = max(texture(uBlurredTexture, fragUV).r, texture(uOriginalTexture, fragUV).r);
    outColor = vec4(fragOutputColor * value, value);
}
`;

    function mapLinear(value, iMin, iMax, oMin, oMax) {
        const t = (value - iMin) / (iMax - iMin);
        return t * (oMax - oMin) + oMin;
    }

    function clamp(x, min, max) {
        return Math.min(Math.max(x, min), max);
    }

    function createShader(gl, type, source, name) {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
            const log = gl.getShaderInfoLog(shader);
            console.error(`[Visualizer] Failed to compile '${name}' shader`, log);
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function createProgram(gl, vertSource, fragSource, name) {
        const vert = createShader(gl, gl.VERTEX_SHADER, vertSource, `${name} vertex`);
        if (!vert) return null;
        const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSource, `${name} fragment`);
        if (!frag) return null;

        const program = gl.createProgram();
        if (!program) return null;
        gl.attachShader(program, vert);
        gl.attachShader(program, frag);
        gl.linkProgram(program);

        gl.deleteShader(vert);
        gl.deleteShader(frag);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
            const log = gl.getProgramInfoLog(program);
            console.error(`[Visualizer] Failed to link '${name}' program`, log);
            gl.deleteProgram(program);
            return null;
        }

        return program;
    }

    function createFramebuffer(gl, filter) {
        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) return null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        const texture = gl.createTexture();
        if (!texture) return null;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        return { framebuffer, texture };
    }

    class NCSVisualizerOverlay {
        constructor(canvas) {
            this.canvas = canvas;
            this.gl = null;
            this.state = null;

            this.audioElement = null;
            this.analyserNode = null;
            this.timeDomainBuffer = null;

            this.outputColor = { r: 255, g: 255, b: 255 };
            this.seed = 1;

            this.isRunning = false;
            this.rafId = 0;

            // Performance tuning
            // Aim for high refresh by default; adaptive quality will reduce internal resolution if needed.
            this.targetFps = 90;
            // Prefer full-res dots; adaptive quality can downscale if needed.
            this.renderScale = 1.0;
            this.minRenderScale = 0.5;
            this.maxRenderScale = 1.0;
            this.adaptiveQuality = true;
            // Render blur at lower resolution (glow is cheaper to downsample than the dot field).
            this.blurScale = 0.6;
            this.minBlurScale = 0.35;
            this.maxBlurScale = 1.0;
            // Hard cap on internal render size to avoid Chromium tile-memory warnings on large / high-DPI panels.
            this.maxRenderArea = 4_000_000;
            // Cap the WebGL drawing buffer size (canvas backing store) to avoid Chromium tile memory warnings
            // and reduce fill-rate pressure on large/high-DPI panels.
            this.maxCanvasArea = 8_000_000;
            this.lastRafTime = null;
            this.estimatedVsyncFrameTime = null;
            this.smoothedFrameTime = null;
            this.smoothedRenderFrameTime = null;
            this.lastDotCount = 0;
            this.lastQualityUpdateTime = 0;
            this.framesSinceQualityUpdate = 0;
            this.missedFrames = 0;
            this.lastUpscaleAttemptTime = 0;
            // FPS fallback (prefer stable 60fps over jittery 90fps on weaker GPUs).
            this.autoTargetFps = true;
            this.lowTargetFps = 60;
            this.highTargetFps = 90;
            this.lastFpsChangeTime = 0;
            this.badFpsSeconds = 0;
            this.goodFpsSeconds = 0;
            this.frameAccumulatorMs = 0;
            this.lastRenderTime = null;

            this.amplitudeWindowSec = 0.15;
            this.amplitudeSamples = [];
            this.amplitudeIntegral = 0;
            this.lastProgressSec = null;

            this.resizeObserver = null;
            this.pendingResize = true;
        }

        setTargetFps(fps) {
            const n = Number(fps);
            if (!Number.isFinite(n)) return;
            this.targetFps = Math.max(30, Math.min(240, Math.round(n)));
        }

        setAutoTargetFps(enabled) {
            this.autoTargetFps = !!enabled;
        }

        setAdaptiveQuality(enabled) {
            this.adaptiveQuality = !!enabled;
        }

        setRenderScale(scale) {
            const next = clamp(Number(scale), this.minRenderScale, this.maxRenderScale);
            if (!Number.isFinite(next)) return;
            if (Math.abs(next - this.renderScale) < 0.01) return;
            this.renderScale = next;
            this.requestResize();
        }

        setBlurScale(scale) {
            const next = clamp(Number(scale), this.minBlurScale, this.maxBlurScale);
            if (!Number.isFinite(next)) return;
            if (Math.abs(next - this.blurScale) < 0.01) return;
            this.blurScale = next;
            this.requestResize();
        }

        getStats() {
            const state = this.state;
            const fps = this.smoothedRenderFrameTime ? 1000 / this.smoothedRenderFrameTime : null;
            const rafFps = this.smoothedFrameTime ? 1000 / this.smoothedFrameTime : null;
            return {
                isRunning: this.isRunning,
                fps: fps ? Math.round(fps * 10) / 10 : null,
                rafFps: rafFps ? Math.round(rafFps * 10) / 10 : null,
                targetFps: this.targetFps,
                renderScale: Math.round(this.renderScale * 100) / 100,
                blurScale: Math.round((this.blurScale || 0) * 100) / 100,
                dotCount: this.lastDotCount || null,
                canvasWidth: state?.canvasWidth ?? null,
                canvasHeight: state?.canvasHeight ?? null,
                displaySize: state?.displaySize ?? null,
                viewportWidth: state?.viewportWidth ?? null,
                viewportHeight: state?.viewportHeight ?? null,
                blurWidth: state?.blurWidth ?? null,
                blurHeight: state?.blurHeight ?? null,
                devicePixelRatio: window.devicePixelRatio || 1
            };
        }

        setAudioSource(audioElement, analyserNode) {
            this.audioElement = audioElement || null;
            this.analyserNode = analyserNode || null;
            this.timeDomainBuffer = null;
        }

        setSeed(seed) {
            this.seed = seed | 0;
        }

        setColor(rgb) {
            if (!rgb) return;
            this.outputColor = {
                r: clamp(rgb.r | 0, 0, 255),
                g: clamp(rgb.g | 0, 0, 255),
                b: clamp(rgb.b | 0, 0, 255)
            };
        }

        requestResize() {
            this.pendingResize = true;
        }

        start() {
            if (this.isRunning) return;
            if (!this.canvas) return;

            if (!this._ensureGL()) return;

            this.isRunning = true;
            this._ensureResizeObserver();
            this.requestResize();

            this.lastRafTime = null;
            this.estimatedVsyncFrameTime = null;
            this.smoothedFrameTime = null;
            this.smoothedRenderFrameTime = null;
            this.lastQualityUpdateTime = 0;
            this.framesSinceQualityUpdate = 0;
            this.missedFrames = 0;
            this.frameAccumulatorMs = 0;
            this.lastRenderTime = null;
            this.lastFpsChangeTime = 0;
            this.badFpsSeconds = 0;
            this.goodFpsSeconds = 0;

            this.rafId = requestAnimationFrame((t) => this._frame(t));
        }

        stop() {
            this.isRunning = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }

        _ensureResizeObserver() {
            if (this.resizeObserver) return;
            if (typeof ResizeObserver === "undefined") return;

            this.resizeObserver = new ResizeObserver(() => this.requestResize());
            const parent = this.canvas.parentElement || this.canvas;
            this.resizeObserver.observe(parent);
        }

        _ensureGL() {
            if (this.state) return true;

            const gl = this.canvas.getContext("webgl2", {
                alpha: false,
                premultipliedAlpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: "high-performance"
            });

            if (!gl) {
                console.error("[Visualizer] WebGL2 is not supported");
                return false;
            }

            if (!gl.getExtension("EXT_color_buffer_float")) {
                console.error("[Visualizer] Rendering to floating-point textures is not supported");
                return false;
            }

            const particleShader = createProgram(gl, PARTICLE_VERT_SHADER, PARTICLE_FRAG_SHADER, "particle");
            const dotShader = createProgram(gl, DOT_VERT_SHADER, DOT_FRAG_SHADER, "dot");
            const blurShader = createProgram(gl, BLUR_VERT_SHADER, BLUR_FRAG_SHADER, "blur");
            const finalizeShader = createProgram(gl, FINALIZE_VERT_SHADER, FINALIZE_FRAG_SHADER, "finalize");
            if (!particleShader || !dotShader || !blurShader || !finalizeShader) return false;

            const quadBuffer = gl.createBuffer();
            if (!quadBuffer) return false;
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
                gl.STATIC_DRAW
            );

            const particleFb = createFramebuffer(gl, gl.NEAREST);
            const dotFb = createFramebuffer(gl, gl.NEAREST);
            const blurXFb = createFramebuffer(gl, gl.LINEAR);
            const blurYFb = createFramebuffer(gl, gl.LINEAR);
            if (!particleFb || !dotFb || !blurXFb || !blurYFb) return false;

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.MAX);
            gl.blendFunc(gl.ONE, gl.ONE);

            this.gl = gl;
            this.state = {
                isError: false,
                canvasWidth: 0,
                canvasHeight: 0,
                displayX: 0,
                displayY: 0,
                displaySize: 0,
                viewportWidth: 0,
                viewportHeight: 0,
                viewportSize: 0,
                blurWidth: 0,
                blurHeight: 0,
                particleTextureSize: 0,

                particleShader,
                dotShader,
                blurShader,
                finalizeShader,

                inPositionLoc: gl.getAttribLocation(particleShader, "inPosition"),
                inPositionLocDot: gl.getAttribLocation(dotShader, "inPosition"),
                inPositionLocBlur: gl.getAttribLocation(blurShader, "inPosition"),
                inPositionLocFinalize: gl.getAttribLocation(finalizeShader, "inPosition"),

                uNoiseOffsetLoc: gl.getUniformLocation(particleShader, "uNoiseOffset"),
                uAmplitudeLoc: gl.getUniformLocation(particleShader, "uAmplitude"),
                uSeedLoc: gl.getUniformLocation(particleShader, "uSeed"),
                uDotSpacingLoc: gl.getUniformLocation(particleShader, "uDotSpacing"),
                uDotOffsetLoc: gl.getUniformLocation(particleShader, "uDotOffset"),
                uSphereRadiusLoc: gl.getUniformLocation(particleShader, "uSphereRadius"),
                uFeatherLoc: gl.getUniformLocation(particleShader, "uFeather"),
                uNoiseFrequencyLoc: gl.getUniformLocation(particleShader, "uNoiseFrequency"),
                uNoiseAmplitudeLoc: gl.getUniformLocation(particleShader, "uNoiseAmplitude"),

                uDotCountLoc: gl.getUniformLocation(dotShader, "uDotCount"),
                uDotRadiusLoc: gl.getUniformLocation(dotShader, "uDotRadius"),
                uDotRadiusPXLoc: gl.getUniformLocation(dotShader, "uDotRadiusPX"),
                uParticleTextureLoc: gl.getUniformLocation(dotShader, "uParticleTexture"),

                uBlurRadiusLoc: gl.getUniformLocation(blurShader, "uBlurRadius"),
                uBlurDirectionLoc: gl.getUniformLocation(blurShader, "uBlurDirection"),
                uBlurInputTextureLoc: gl.getUniformLocation(blurShader, "uInputTexture"),

                uOutputColorLoc: gl.getUniformLocation(finalizeShader, "uOutputColor"),
                uBlurredTextureLoc: gl.getUniformLocation(finalizeShader, "uBlurredTexture"),
                uOriginalTextureLoc: gl.getUniformLocation(finalizeShader, "uOriginalTexture"),

                quadBuffer,

                particleFramebuffer: particleFb.framebuffer,
                particleTexture: particleFb.texture,
                dotFramebuffer: dotFb.framebuffer,
                dotTexture: dotFb.texture,
                blurXFramebuffer: blurXFb.framebuffer,
                blurXTexture: blurXFb.texture,
                blurYFramebuffer: blurYFb.framebuffer,
                blurYTexture: blurYFb.texture
            };

            return true;
        }

        _resizeIfNeeded() {
            if (!this.pendingResize) return;
            this.pendingResize = false;

            const gl = this.gl;
            const state = this.state;
            if (!gl || !state) return;

            const parent = this.canvas.parentElement;
            if (parent) {
                const parentRect = parent.getBoundingClientRect();
                const cssSize = Math.max(1, Math.min(parentRect.width, parentRect.height));
                if (Number.isFinite(cssSize) && cssSize > 0) {
                    const cssSizeInt = Math.floor(cssSize);
                    const sizePx = `${cssSizeInt}px`;
                    if (this.canvas.style.width !== sizePx) {
                        this.canvas.style.width = sizePx;
                        this.canvas.style.height = sizePx;
                    }
                    const leftPx = `${Math.floor((parentRect.width - cssSizeInt) / 2)}px`;
                    const topPx = `${Math.floor((parentRect.height - cssSizeInt) / 2)}px`;
                    if (this.canvas.style.left !== leftPx) this.canvas.style.left = leftPx;
                    if (this.canvas.style.top !== topPx) this.canvas.style.top = topPx;
                }
            }

            const rect = this.canvas.getBoundingClientRect();
            const rawDpr = window.devicePixelRatio || 1;
            let dpr = rawDpr;
            if (this.maxCanvasArea && rect.width > 0 && rect.height > 0) {
                const rawArea = rect.width * rect.height * dpr * dpr;
                if (rawArea > this.maxCanvasArea) {
                    dpr = Math.sqrt(this.maxCanvasArea / (rect.width * rect.height));
                }
            }
            dpr = clamp(dpr, 0.5, rawDpr);

            const canvasWidth = Math.max(1, Math.round(rect.width * dpr));
            const canvasHeight = Math.max(1, Math.round(rect.height * dpr));

            const canvasSizeChanged = this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight;

            if (this.canvas.width !== canvasWidth) this.canvas.width = canvasWidth;
            if (this.canvas.height !== canvasHeight) this.canvas.height = canvasHeight;

            state.canvasWidth = canvasWidth;
            state.canvasHeight = canvasHeight;

            // Display region: largest centered square. Keeps the visualizer non-stretched
            // and uses black bars for remaining space.
            const displaySize = Math.max(1, Math.min(canvasWidth, canvasHeight));
            state.displaySize = displaySize;
            state.displayX = Math.floor((canvasWidth - displaySize) / 2);
            state.displayY = Math.floor((canvasHeight - displaySize) / 2);

            // Internal render resolution can be scaled independently for performance.
            const scale = this.renderScale || 1;
            let renderSize = Math.max(1, Math.round(displaySize * scale));
            if (this.maxRenderArea) {
                const maxSize = Math.max(1, Math.floor(Math.sqrt(this.maxRenderArea)));
                renderSize = Math.min(renderSize, maxSize);
            }

            state.viewportWidth = renderSize;
            state.viewportHeight = renderSize;
            state.viewportSize = renderSize;

            const blurScale = clamp(
                Number.isFinite(this.blurScale) ? this.blurScale : 1,
                this.minBlurScale || 0.25,
                this.maxBlurScale || 1
            );
            state.blurWidth = Math.max(1, Math.round(state.viewportWidth * blurScale));
            state.blurHeight = Math.max(1, Math.round(state.viewportHeight * blurScale));

            gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.R8,
                state.viewportWidth,
                state.viewportHeight,
                0,
                gl.RED,
                gl.UNSIGNED_BYTE,
                null
            );

            gl.bindTexture(gl.TEXTURE_2D, state.blurXTexture);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.R8,
                state.blurWidth,
                state.blurHeight,
                0,
                gl.RED,
                gl.UNSIGNED_BYTE,
                null
            );

            gl.bindTexture(gl.TEXTURE_2D, state.blurYTexture);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.R8,
                state.blurWidth,
                state.blurHeight,
                0,
                gl.RED,
                gl.UNSIGNED_BYTE,
                null
            );

            // Clear once on resize so the letterbox bars stay black without a full-canvas clear every frame.
            if (canvasSizeChanged) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.viewport(0, 0, canvasWidth, canvasHeight);
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
        }

        _getAmplitude() {
            const analyser = this.analyserNode;
            if (!analyser) return 0;

            const fftSize = analyser.fftSize || 2048;
            if (!this.timeDomainBuffer || this.timeDomainBuffer.length !== fftSize) {
                this.timeDomainBuffer = new Float32Array(fftSize);
            }

            if (typeof analyser.getFloatTimeDomainData === "function") {
                analyser.getFloatTimeDomainData(this.timeDomainBuffer);
                let sum = 0;
                for (let i = 0; i < this.timeDomainBuffer.length; i++) {
                    const v = this.timeDomainBuffer[i];
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / this.timeDomainBuffer.length);
                const amp = clamp(rms * 3.0, 0, 1);
                return Math.pow(amp, 0.6);
            }

            const byteBuf = new Uint8Array(fftSize);
            analyser.getByteTimeDomainData(byteBuf);
            let sum = 0;
            for (let i = 0; i < byteBuf.length; i++) {
                const v = (byteBuf[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / byteBuf.length);
            const amp = clamp(rms * 3.0, 0, 1);
            return Math.pow(amp, 0.6);
        }

        _updateAmplitude(progressSec, amplitude) {
            const last = this.lastProgressSec;
            if (last === null || progressSec < last - 0.25 || progressSec - last > 2) {
                this.amplitudeSamples = [];
                this.amplitudeIntegral = 0;
            }

            this.lastProgressSec = progressSec;

            this.amplitudeSamples.push({ t: progressSec, a: amplitude });
            const cutoff = progressSec - this.amplitudeWindowSec;
            while (this.amplitudeSamples.length && this.amplitudeSamples[0].t < cutoff) {
                this.amplitudeSamples.shift();
            }

            let avg = 0;
            for (let i = 0; i < this.amplitudeSamples.length; i++) avg += this.amplitudeSamples[i].a;
            avg = this.amplitudeSamples.length ? avg / this.amplitudeSamples.length : amplitude;

            if (last !== null && progressSec >= last) {
                const dt = progressSec - last;
                if (dt > 0 && dt < 1) this.amplitudeIntegral += avg * dt;
            }

            return avg;
        }

        _frame(time) {
            if (!this.isRunning) return;
            this.rafId = requestAnimationFrame((t) => this._frame(t));

            const dt = this.lastRafTime === null ? null : time - this.lastRafTime;
            this.lastRafTime = time;
            const desiredFrameTime = 1000 / (this.targetFps || 60);
            const vsyncFrameTime = this.estimatedVsyncFrameTime || desiredFrameTime;
            if (dt !== null && dt > 0 && dt < 250) {
                this.smoothedFrameTime = this.smoothedFrameTime === null ? dt : this.smoothedFrameTime * 0.9 + dt * 0.1;
                this.estimatedVsyncFrameTime =
                    this.estimatedVsyncFrameTime === null ? dt : Math.min(this.estimatedVsyncFrameTime, dt);

                const targetFrameTime = Math.max(desiredFrameTime, vsyncFrameTime);

                // Adaptive resolution scaling to keep the renderer vsync-stable.
                if (this.adaptiveQuality) {
                    const missed = dt > targetFrameTime * 1.25;
                    this.framesSinceQualityUpdate++;
                    if (missed) this.missedFrames++;

                    if (time - this.lastQualityUpdateTime > 1000) {
                        const missRatio = this.missedFrames / Math.max(1, this.framesSinceQualityUpdate);

                        // FPS fallback: prefer stable 60fps over jittery 90fps.
                        const prevTargetFps = this.targetFps;
                        if (this.autoTargetFps) {
                            const estimatedVsync = this.estimatedVsyncFrameTime || vsyncFrameTime;
                            const isHighRefresh = Number.isFinite(estimatedVsync) && estimatedVsync < 13.0;
                            const minIntervalMs = 7000;

                            if (!isHighRefresh) {
                                this.badFpsSeconds = 0;
                                this.goodFpsSeconds = 0;
                                if (this.targetFps !== this.lowTargetFps) {
                                    this.setTargetFps(this.lowTargetFps);
                                    this.lastFpsChangeTime = time;
                                }
                            } else if (this.targetFps > this.lowTargetFps + 1) {
                                if (missRatio > 0.12) {
                                    this.badFpsSeconds++;
                                    this.goodFpsSeconds = 0;
                                } else {
                                    this.badFpsSeconds = 0;
                                }

                                if (this.badFpsSeconds >= 2 && time - this.lastFpsChangeTime > minIntervalMs) {
                                    this.setTargetFps(this.lowTargetFps);
                                    this.lastFpsChangeTime = time;
                                    this.badFpsSeconds = 0;
                                    this.goodFpsSeconds = 0;
                                }
                            } else {
                                const nearMaxQuality =
                                    this.renderScale >= (this.maxRenderScale || 1) - 0.02 &&
                                    (this.blurScale || 1) >= (this.maxBlurScale || 1) - 0.02;

                                if (missRatio === 0 && nearMaxQuality) {
                                    this.goodFpsSeconds++;
                                    this.badFpsSeconds = 0;
                                } else {
                                    this.goodFpsSeconds = 0;
                                }

                                if (this.goodFpsSeconds >= 8 && time - this.lastFpsChangeTime > minIntervalMs) {
                                    this.setTargetFps(this.highTargetFps);
                                    this.lastFpsChangeTime = time;
                                    this.goodFpsSeconds = 0;
                                    this.badFpsSeconds = 0;
                                }
                            }
                        }
                        const loweredFps = this.targetFps < prevTargetFps;

                        if (!loweredFps && missRatio > 0.05) {
                            // Prefer reducing blur resolution first (cheaper) before lowering main render resolution.
                            if ((this.blurScale || 1) > (this.minBlurScale || 0.25) + 0.02) {
                                const stepDown = missRatio > 0.2 ? 0.12 : 0.08;
                                this.setBlurScale((this.blurScale || 1) - stepDown);
                                this.lastUpscaleAttemptTime = time;
                            } else if (this.renderScale > this.minRenderScale) {
                                const stepDown = missRatio > 0.2 ? 0.1 : 0.05;
                                this.setRenderScale(this.renderScale - stepDown);
                                this.lastUpscaleAttemptTime = time;
                            }
                        } else if (missRatio === 0 && time - this.lastUpscaleAttemptTime > 4000) {
                            // Restore main resolution first, then blur resolution.
                            if (this.renderScale < this.maxRenderScale) {
                                this.setRenderScale(this.renderScale + 0.05);
                                this.lastUpscaleAttemptTime = time;
                            } else if ((this.blurScale || 0) < (this.maxBlurScale || 1)) {
                                this.setBlurScale((this.blurScale || 0) + 0.05);
                                this.lastUpscaleAttemptTime = time;
                            }
                        }

                        this.framesSinceQualityUpdate = 0;
                        this.missedFrames = 0;
                        this.lastQualityUpdateTime = time;
                    }
                }
            }

            // Frame pacing: render at (approximately) `targetFps` even if the display refresh is higher.
            // On 90Hz displays and a 60fps target this effectively renders ~2/3 frames.
            const shouldPace = desiredFrameTime > vsyncFrameTime * 1.15;
            if (shouldPace && dt !== null && dt > 0 && dt < 250) {
                this.frameAccumulatorMs = Math.min(this.frameAccumulatorMs + dt, desiredFrameTime * 4);
                if (this.frameAccumulatorMs < desiredFrameTime) return;
                this.frameAccumulatorMs -= desiredFrameTime;
            } else if (!shouldPace) {
                this.frameAccumulatorMs = 0;
            }

            const gl = this.gl;
            const state = this.state;
            if (!gl || !state) return;

            const dtRender = this.lastRenderTime === null ? null : time - this.lastRenderTime;
            this.lastRenderTime = time;
            if (dtRender !== null && dtRender > 0 && dtRender < 250) {
                this.smoothedRenderFrameTime =
                    this.smoothedRenderFrameTime === null ? dtRender : this.smoothedRenderFrameTime * 0.9 + dtRender * 0.1;
            }

            this._resizeIfNeeded();

            const audio = this.audioElement;
            const progressSec = audio ? audio.currentTime || 0 : 0;
            const rawAmplitude = this._getAmplitude();
            const uAmplitude = this._updateAmplitude(progressSec, rawAmplitude);

            const uNoiseOffset = (0.5 * progressSec + this.amplitudeIntegral) * 75 * 0.01;
            const uSeed = this.seed;

            // Keep the original dense particle field.
            const uDotCount = 322;
            this.lastDotCount = uDotCount;

            const uDotRadius = 0.9 / uDotCount;
            const uDotRadiusPX = uDotRadius * 0.5 * state.viewportSize;
            const uDotSpacing = 0.9;
            const uDotOffset = -0.9 / 2;
            const uSphereRadius = mapLinear(uAmplitude, 0, 1, 0.75 * 0.9, 0.9);
            const uFeather = Math.pow(uAmplitude + 3, 2) * (45 / 1568);
            const uNoiseFrequency = 4;
            const uNoiseAmplitude = 0.32 * 0.9;

            if (state.particleTextureSize !== uDotCount) {
                state.particleTextureSize = uDotCount;
                gl.bindTexture(gl.TEXTURE_2D, state.particleTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, uDotCount, uDotCount, 0, gl.RG, gl.FLOAT, null);
            }

            // calculate particle positions
            gl.disable(gl.BLEND);
            gl.bindFramebuffer(gl.FRAMEBUFFER, state.particleFramebuffer);
            gl.viewport(0, 0, uDotCount, uDotCount);

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(state.particleShader);
            gl.uniform1f(state.uNoiseOffsetLoc, uNoiseOffset);
            gl.uniform1f(state.uAmplitudeLoc, uAmplitude);
            gl.uniform1i(state.uSeedLoc, uSeed);
            gl.uniform1f(state.uDotSpacingLoc, uDotSpacing);
            gl.uniform1f(state.uDotOffsetLoc, uDotOffset);
            gl.uniform1f(state.uSphereRadiusLoc, uSphereRadius);
            gl.uniform1f(state.uFeatherLoc, uFeather);
            gl.uniform1f(state.uNoiseFrequencyLoc, uNoiseFrequency);
            gl.uniform1f(state.uNoiseAmplitudeLoc, uNoiseAmplitude);

            gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
            gl.enableVertexAttribArray(state.inPositionLoc);
            gl.vertexAttribPointer(state.inPositionLoc, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

            // render dots
            gl.enable(gl.BLEND);
            gl.bindFramebuffer(gl.FRAMEBUFFER, state.dotFramebuffer);
            gl.viewport(0, 0, state.viewportWidth, state.viewportHeight);

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(state.dotShader);
            gl.uniform1i(state.uDotCountLoc, uDotCount);
            gl.uniform1f(state.uDotRadiusLoc, uDotRadius);
            gl.uniform1f(state.uDotRadiusPXLoc, uDotRadiusPX);
            gl.uniform1i(state.uParticleTextureLoc, 0);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, state.particleTexture);

            gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
            gl.enableVertexAttribArray(state.inPositionLocDot);
            gl.vertexAttribPointer(state.inPositionLocDot, 2, gl.FLOAT, false, 0, 0);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, uDotCount * uDotCount);

            // Blur + finalize are full-screen quads; blending isn't needed and can cause accumulation artifacts
            // if we avoid clearing the entire canvas every frame.
            gl.disable(gl.BLEND);

            // blur in X direction
            gl.bindFramebuffer(gl.FRAMEBUFFER, state.blurXFramebuffer);
            gl.viewport(0, 0, state.blurWidth, state.blurHeight);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(state.blurShader);
            // The blur pass cost grows quickly with radius (more taps). Keep it capped for performance.
            const blurScale = state.blurWidth / Math.max(1, state.viewportWidth);
            const blurRadiusPx = Math.max(1.5, Math.min(0.01 * state.viewportSize, 18)) * blurScale;
            gl.uniform1f(state.uBlurRadiusLoc, blurRadiusPx);
            gl.uniform2f(state.uBlurDirectionLoc, 1 / state.blurWidth, 0);
            gl.uniform1i(state.uBlurInputTextureLoc, 0);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);

            gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
            gl.enableVertexAttribArray(state.inPositionLocBlur);
            gl.vertexAttribPointer(state.inPositionLocBlur, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

            // blur in Y direction
            gl.bindFramebuffer(gl.FRAMEBUFFER, state.blurYFramebuffer);
            gl.viewport(0, 0, state.blurWidth, state.blurHeight);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.uniform2f(state.uBlurDirectionLoc, 0, 1 / state.blurHeight);
            gl.bindTexture(gl.TEXTURE_2D, state.blurXTexture);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

            // final combine
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            const canvasW = state.canvasWidth || this.canvas.width || state.viewportWidth;
            const canvasH = state.canvasHeight || this.canvas.height || state.viewportHeight;

            const displaySize = state.displaySize || Math.min(canvasW, canvasH);
            const displayX = Number.isFinite(state.displayX) ? state.displayX : Math.floor((canvasW - displaySize) / 2);
            const displayY = Number.isFinite(state.displayY) ? state.displayY : Math.floor((canvasH - displaySize) / 2);
            gl.viewport(displayX, displayY, displaySize, displaySize);

            gl.useProgram(state.finalizeShader);
            gl.uniform3f(
                state.uOutputColorLoc,
                this.outputColor.r / 255,
                this.outputColor.g / 255,
                this.outputColor.b / 255
            );
            gl.uniform1i(state.uBlurredTextureLoc, 0);
            gl.uniform1i(state.uOriginalTextureLoc, 1);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, state.blurYTexture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, state.dotTexture);

            gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
            gl.enableVertexAttribArray(state.inPositionLocFinalize);
            gl.vertexAttribPointer(state.inPositionLocFinalize, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        }
    }

    window.NCSVisualizerOverlay = NCSVisualizerOverlay;
})();
