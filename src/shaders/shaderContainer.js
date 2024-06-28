export const commonShaderSource = `
// common shader source
precision mediump float;

#define PI 3.14159265359
#define TAU 6.28318530718

const vec3 theme = vec3(0.118, 0.580, 0.643);

vec2 s = vec2(1, 1.7320508);

float hash11(float p) {
    p = fract(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float circle(in vec2 uv, in float rad) {
    return smoothstep(rad, rad - 8.0 / 800.0, length(uv) - rad); // assuming a default width of 800 for bias calculation
}

float hex(in vec2 p) {
    p = abs(p);
    return max(dot(p, s * 0.5), p.x);
}

vec4 getHex(vec2 p) {
    vec4 hC = floor(vec4(p, p - vec2(0.5, 1)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}

vec3 hsb2rgb(in vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    rgb = rgb * rgb * (3.0 - 2.0 * rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}
`;

export const bufferAShaderSource = `
${commonShaderSource}
precision mediump float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform sampler2D iChannel0;
varying vec2 v_texCoord;


const int fib_points = 300;
float gRatio = (1.0 + pow(5.0, 0.5)) / 2.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (2.0 * fragCoord.xy - iResolution.xy) / iResolution.y;
    vec2 m = (2.0 * iMouse.xy - iResolution.xy) / iResolution.y;
        
    vec3 col = vec3(0.0), _theme = theme;
    
    float orb = 0.25;
    float t = (iTime + 80.0) / 3.0;
    
    float theta, phi;
    for (int i = 0; i < fib_points; i++) {
        theta = 2.0 * PI * float(i) / gRatio;
        phi = sin(acos(1.0 - 2.0 * float(i) / float(fib_points)));
        phi *= 0.475;
        
        float rd = (hash11(float(i)) > 0.5 ? 1.0 : -1.0);
        theta -= t * rd;
        
        col += circle(uv + vec2(cos(theta) * phi, sin(theta) * phi), (14.0 / iResolution.x)) * _theme * ((abs(sin(theta) * phi) + abs(cos(theta) * phi)) / 5.0);
    }
    
    col += circle(uv, orb);
    col -= circle(uv, orb - (3.0 / iResolution.y));
    
    vec3 prv = texture2D(iChannel0, v_texCoord).rgb;
    col = mix(col, prv, 0.95);

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

export const imageShaderSource = `
${commonShaderSource}
precision mediump float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform sampler2D iChannel0;
varying vec2 v_texCoord;


vec3 hex_layer(in vec2 uv, in float scale, in vec3 color) {
    vec2 hv = getHex(scale * uv * vec2(iResolution.x / iResolution.y, 1.0)).xy;
    float d = hex(hv);
    
    return mix(vec3(0.0), vec3(1.0), smoothstep(0.0, 0.03, d - 0.5 + 0.04)) * color;
}

vec3 arc_layer(in vec2 uv, in float r, in float o, in vec3 color) {
    float d = circle(uv, r);
    d -= circle(uv, r - o);
    
    float angle = atan(uv.y, uv.x) + PI;
    float rot_speed = iTime / 2.0;
    
    angle += rot_speed;
    
    float lSegments = 3.0, sSegments = 48.0;
    float lAngleSegment = 2.0 * PI, sAngleSegment = 2.0 * PI;
    lAngleSegment /= lSegments;
    sAngleSegment /= sSegments;
    
    float largeSegs = 0.0, smallSegs = 0.0;
    if (abs(mod(angle, lAngleSegment) - lAngleSegment / 2.0) < 0.06) {
        largeSegs = 1.0;
    }
    if (abs(mod(angle, sAngleSegment) - sAngleSegment / 2.0) < 0.01) {
        smallSegs = 1.0;  
    }
    
    d -= smallSegs;
    d -= largeSegs;
    
    return max(0.0, d) * color * 0.2;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 p = (uv - vec2(0.5)) * vec2(iResolution.x / iResolution.y, 1.0);
    vec3 col = vec3(0.0), _theme = theme;
    
    float r = 0.4, thin = 0.02;
    float d = length(p) - r; 
    
    vec3 wave_mask = vec3(1.0);
    wave_mask *= smoothstep(0.2, 0.4, uv.x); 
    wave_mask *= smoothstep(0.2, 0.4, 1.0 - uv.x); 
    
    col += (1.0 - smoothstep(0.0, thin, abs(0.5 - d))) * _theme * max(0.001, 0.5 * 5.0) * wave_mask;
    col += pow(abs(0.025 / d * 0.5), 1.2) * _theme * wave_mask;
    
    vec4 hv = getHex(uv);
    vec3 hexLayer = hex_layer(uv, 25.0, _theme * 1.5);
    col += col * hexLayer;
    
    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;
