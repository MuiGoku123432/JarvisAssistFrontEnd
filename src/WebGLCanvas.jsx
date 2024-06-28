import React, { useRef, useEffect } from 'react';
import { bufferAShaderSource, imageShaderSource } from './shaders/shaderContainer';

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program:', gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

function createAndSetupTexture(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

function createFramebuffer(gl, texture) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return framebuffer;
}

const WebGLCanvas = () => {
    const canvasRef = useRef(null);
    let gl;
    let bufferAProgram, imageProgram;
    let vaoExt;
    let positionBuffer;
    let textureA, textureB;
    let framebufferA, framebufferB;
    let isTextureAActive = true;

    const initializeWebGL = () => {
        const canvas = canvasRef.current;
        gl = canvas.getContext('webgl', { antialias: false, alpha: false });

        if (!gl) {
            console.error('WebGL not supported');
            return;
        }

        // Initialize shaders and programs
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const bufferAFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, bufferAShaderSource);
        const imageFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, imageShaderSource);

        bufferAProgram = createProgram(gl, vertexShader, bufferAFragmentShader);
        imageProgram = createProgram(gl, vertexShader, imageFragmentShader);

        // Initialize position buffer
        const positionAttributeLocation = gl.getAttribLocation(bufferAProgram, 'a_position');
        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = [
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0,
        ];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        // Enable OES_vertex_array_object extension
        vaoExt = gl.getExtension('OES_vertex_array_object');
        if (!vaoExt) {
            console.error('OES_vertex_array_object extension not supported');
            return;
        }
        const vao = vaoExt.createVertexArrayOES();
        vaoExt.bindVertexArrayOES(vao);
        gl.enableVertexAttribArray(positionAttributeLocation);
        gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

        // Initialize textures and framebuffers
        const resizeCanvasToDisplaySize = (canvas) => {
            const displayWidth = canvas.clientWidth;
            const displayHeight = canvas.clientHeight;

            if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
                canvas.width = displayWidth;
                canvas.height = displayHeight;
                return true;
            }
            return false;
        };

        const render = (time) => {
            if (resizeCanvasToDisplaySize(canvas)) {
                gl.viewport(0, 0, canvas.width, canvas.height);
            }
            const width = canvas.width;
            const height = canvas.height;

            if (!textureA) {
                textureA = createAndSetupTexture(gl, width, height);
                textureB = createAndSetupTexture(gl, width, height);
                framebufferA = createFramebuffer(gl, textureA);
                framebufferB = createFramebuffer(gl, textureB);
            }

            time *= 0.001;

            gl.useProgram(bufferAProgram);

            if (isTextureAActive) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebufferA);
            } else {
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebufferB);
            }

            gl.viewport(0, 0, width, height);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.enableVertexAttribArray(gl.getAttribLocation(bufferAProgram, 'a_position'));
            gl.vertexAttribPointer(gl.getAttribLocation(bufferAProgram, 'a_position'), 2, gl.FLOAT, false, 0, 0);

            gl.uniform3f(gl.getUniformLocation(bufferAProgram, 'iResolution'), width, height, 1.0);
            gl.uniform1f(gl.getUniformLocation(bufferAProgram, 'iTime'), time);
            gl.uniform4f(gl.getUniformLocation(bufferAProgram, 'iMouse'), 0.0, 0.0, 0.0, 0.0);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            gl.useProgram(imageProgram);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            gl.viewport(0, 0, width, height);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.enableVertexAttribArray(gl.getAttribLocation(imageProgram, 'a_position'));
            gl.vertexAttribPointer(gl.getAttribLocation(imageProgram, 'a_position'), 2, gl.FLOAT, false, 0, 0);

            gl.activeTexture(gl.TEXTURE0);
            if (isTextureAActive) {
                gl.bindTexture(gl.TEXTURE_2D, textureA);
            } else {
                gl.bindTexture(gl.TEXTURE_2D, textureB);
            }
            gl.uniform1i(gl.getUniformLocation(imageProgram, 'iChannel0'), 0);

            gl.uniform3f(gl.getUniformLocation(imageProgram, 'iResolution'), width, height, 1.0);
            gl.uniform1f(gl.getUniformLocation(imageProgram, 'iTime'), time);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            isTextureAActive = !isTextureAActive;

            requestAnimationFrame(render);
        };

        requestAnimationFrame(render);
    };

    const cleanupWebGL = () => {
        if (gl) {
            if (textureA) gl.deleteTexture(textureA);
            if (textureB) gl.deleteTexture(textureB);
            if (framebufferA) gl.deleteFramebuffer(framebufferA);
            if (framebufferB) gl.deleteFramebuffer(framebufferB);
            if (positionBuffer) gl.deleteBuffer(positionBuffer);
            if (bufferAProgram) gl.deleteProgram(bufferAProgram);
            if (imageProgram) gl.deleteProgram(imageProgram);
        }
    };

    useEffect(() => {
        initializeWebGL();

        const canvas = canvasRef.current;

        const handleContextLost = (event) => {
            event.preventDefault();
            console.error('WebGL context lost');
            cleanupWebGL();
        };

        const handleContextRestored = () => {
            console.log('WebGL context restored');
            initializeWebGL();
        };

        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        return () => {
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
            cleanupWebGL();
        };
    }, []);

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
};

export default WebGLCanvas;
