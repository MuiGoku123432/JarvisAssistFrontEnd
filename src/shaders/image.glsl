precision mediump float;
uniform float iTime;
uniform vec2 iResolution;
uniform sampler2D iChannel0;

void main() {
    vec2 st = gl_FragCoord.xy / iResolution.xy;
    vec4 bufferAColor = texture2D(iChannel0, st);
    gl_FragColor = bufferAColor;
}
