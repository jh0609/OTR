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

void main() {
  vec4 src = texture2D(uMainSampler, outTexCoord);

  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float edgeBand = smoothstep(uAlphaMin, uAlphaMax, src.a);
  float darkMask = 1.0 - smoothstep(uDarkLumThreshold - 0.08, uDarkLumThreshold + 0.08, lum);
  float k = edgeBand * darkMask * uStrength;

  vec3 corrected = mix(src.rgb, uBaseRed, clamp(k, 0.0, 1.0));
  gl_FragColor = vec4(corrected, src.a);
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

