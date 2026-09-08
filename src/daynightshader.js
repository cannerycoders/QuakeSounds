export const DayNightShader = {
  vertexShader: `
varying vec3 vNormal;
varying vec2 vUv;

void main()
{
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;

  gl_Position =
    projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: `
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform vec3 sunDirection;

varying vec3 vNormal;
varying vec2 vUv;

void main()
{
  float intensity = dot(normalize(vNormal), normalize(sunDirection));
  // float intensity = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));

  vec4 dayColor = texture2D(dayTexture, vUv);
  vec4 nightColor = texture2D(nightTexture, vUv);

  float blendFactor = smoothstep(-0.1, 0.1, intensity);

  gl_FragColor = mix(nightColor, dayColor, blendFactor);
}
`
};