import Phaser from "phaser";

const FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMainSampler;
varying vec2 outTexCoord;

uniform vec3 uBaseRed;
uniform float uAlphaMin;
uniform float uAlphaMax;
uniform float uDarkLumThreshold;
uniform float uStrength;
uniform vec2 uTexelSize;

void main() {
  vec4 src = texture2D(uMainSampler, outTexCoord);
  float edgeMix = smoothstep(uAlphaMin, uAlphaMax, src.a);

  // Lightweight edge-only mini AA (5 taps). Center remains sharp.
  vec4 aa = src;
  if (edgeMix > 0.0 && edgeMix < 1.0) {
    vec2 dx = vec2(uTexelSize.x, 0.0);
    vec2 dy = vec2(0.0, uTexelSize.y);
    vec4 s1 = texture2D(uMainSampler, outTexCoord + dx);
    vec4 s2 = texture2D(uMainSampler, outTexCoord - dx);
    vec4 s3 = texture2D(uMainSampler, outTexCoord + dy);
    vec4 s4 = texture2D(uMainSampler, outTexCoord - dy);
    aa = (src * 2.0 + s1 + s2 + s3 + s4) / 6.0;
  }

  float lum = dot(aa.rgb, vec3(0.299, 0.587, 0.114));
  float darkMask = 1.0 - smoothstep(uDarkLumThreshold - 0.08, uDarkLumThreshold + 0.08, lum);
  float k = edgeMix * darkMask * uStrength;

  vec3 corrected = mix(aa.rgb, uBaseRed, clamp(k, 0.0, 1.0));
  gl_FragColor = vec4(corrected, aa.a);
}
`;

export class Lv1FringeFixPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  public static readonly KEY = "Lv1FringeFix";

  constructor(game: Phaser.Game) {
    super({
      game,
      fragShader: FRAG_SHADER,
    });
  }
}

