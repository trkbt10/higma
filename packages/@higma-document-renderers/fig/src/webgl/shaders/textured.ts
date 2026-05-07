/**
 * @file Textured (image) shader
 */

export const texturedVertexShader = `
  attribute vec2 a_position;
  uniform mat3 u_transform;
  uniform vec2 u_resolution;
  varying vec2 v_texCoord;

  void main() {
    vec3 transformed = u_transform * vec3(a_position, 1.0);
    vec2 clipSpace = (transformed.xy / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
    // UV coordinates from position (normalized to 0..1)
    v_texCoord = a_position;
  }
`;

export const texturedFragmentShader = `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform float u_opacity;
  uniform vec2 u_texScale;
  uniform vec2 u_texOffset;
  uniform bool u_repeat;
  uniform bool u_clipTransparent;
  uniform bool u_hasPaintFilter;
  uniform float u_exposure;
  uniform float u_contrast;
  uniform float u_brightness;
  uniform float u_temperature;
  uniform float u_tint;
  uniform float u_saturation;
  uniform float u_vibrance;

  varying vec2 v_texCoord;

  const float SRGB_TRANSFER_EXPONENT = 2.4;

  float decodeSrgb(float value) {
    if (value <= 0.04045) {
      return value / 12.92;
    }
    return pow((value + 0.055) / 1.055, SRGB_TRANSFER_EXPONENT);
  }

  float encodeSrgb(float value) {
    if (value <= 0.0031308) {
      return value * 12.92;
    }
    return 1.055 * pow(value, 1.0 / SRGB_TRANSFER_EXPONENT) - 0.055;
  }

  float linearSrgbLuminance(vec3 color) {
    vec3 linear = vec3(decodeSrgb(color.r), decodeSrgb(color.g), decodeSrgb(color.b));
    return encodeSrgb(dot(linear, vec3(0.2126, 0.7152, 0.0722)));
  }

  vec3 applyPaintFilter(vec3 color) {
    float saturation = 1.0 + u_saturation + u_vibrance;
    float gray = linearSrgbLuminance(color);
    vec3 saturated = mix(vec3(gray), color, saturation);
    vec3 exposed = saturated * pow(2.0, u_exposure);
    vec3 brightened = exposed + vec3(u_brightness);
    vec3 contrasted = (brightened - vec3(0.5)) * (1.0 + u_contrast) + vec3(0.5);
    vec3 shifted = contrasted + vec3(u_temperature * 0.08, u_tint * 0.08, u_temperature * -0.08);
    return clamp(shifted, 0.0, 1.0);
  }

  void main() {
    vec2 uv = v_texCoord * u_texScale + u_texOffset;
    if (u_repeat) {
      uv = fract(uv);
    } else if (u_clipTransparent && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) {
      discard;
    }
    vec4 texColor = texture2D(u_texture, uv);
    if (u_hasPaintFilter) {
      texColor = vec4(applyPaintFilter(texColor.rgb), texColor.a);
    }
    gl_FragColor = texColor * u_opacity;
  }
`;
