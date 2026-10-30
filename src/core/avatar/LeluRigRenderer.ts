/**
 * ==========================================================
 * LÉLU — HER RIG ON A PLAIN WEBGL CANVAS
 *
 * One quad, one fragment shader (LeluRig.RIG_FRAGMENT_SHADER), her look
 * as a texture. The canvas is transparent: nothing is drawn where she is
 * not — no card, no frame, no background. Pixels are premultiplied, so
 * her edges blend into whatever is behind the canvas.
 * ==========================================================
 */

import type { AnimationParams } from "./LeluAnimation";
import { RIG_FRAGMENT_SHADER, RIG_VERTEX_SHADER, rigUniforms, viewFor, type LeluFraming, type LoadedLook } from "./LeluRig";

type GL = WebGLRenderingContext | WebGL2RenderingContext;

export default class LeluRigRenderer {
  private readonly gl: GL;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  private look: LoadedLook | null = null;

  /** Throws when the device has no WebGL (callers show her still image instead). */
  constructor(private readonly canvas: HTMLCanvasElement) {
    const options: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false };
    const gl = (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) as GL | null;
    if (!gl) throw new Error("WebGL is not available on this device.");
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`LÉLU's shader did not compile: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, RIG_VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, RIG_FRAGMENT_SHADER));
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`LÉLU's shader did not link: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);
  }

  public setLook(look: LoadedLook): void {
    if (this.look === look) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, look.image);
    // Mipmaps keep her crisp when drawn small (WebGL 2: any size).
    if (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    this.look = look;
  }

  /** Draw this moment of her into the canvas at its displayed size. */
  public draw(params: AnimationParams, options: { framing: LeluFraming; holo: number; time: number; pixelRatio?: number }): void {
    const look = this.look;
    if (!look) return;
    const gl = this.gl;
    const ratio = Math.min(2, options.pixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1) ?? 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    const uniforms = rigUniforms(look.rig, params, {
      view: viewFor(look.rig, options.framing, width / height),
      framing: options.framing,
      holo: options.holo,
      time: options.time,
    });
    for (const [name, value] of Object.entries(uniforms)) {
      let location = this.locations.get(name);
      if (location === undefined) {
        location = gl.getUniformLocation(this.program, name);
        this.locations.set(name, location);
      }
      if (!location) continue;
      if (typeof value === "number") gl.uniform1f(location, value);
      else if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
      else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
      else gl.uniform4f(location, value[0], value[1], value[2], value[3]);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  public dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
