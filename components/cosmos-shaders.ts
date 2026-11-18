/** Procedural, seeded surfaces. No image assets or network services are used. */
export const surfaceVertex = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vLocal = normalize(position);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const noise = /* glsl */ `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.17, 0.31, 0.53));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    f += noise3(p) * a;
    p = p * 2.07 + vec3(7.3, 2.1, 4.9);
    a *= 0.49;
  }
  return f;
}
`;

export const surfaceFragment = /* glsl */ `
precision highp float;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorld;
uniform float uSeed;
uniform float uWater;
uniform float uTemperature;
uniform float uYear;
uniform float uKind;
uniform float uLayer;
uniform float uHasAtmosphere;
uniform vec3 uBaseColor;
uniform vec3 uLight;
uniform vec3 uCityDirections[12];
uniform vec3 uCityColors[12];
uniform float uCitySizes[12];
uniform int uCityCount;
${noise}

void main() {
  vec3 p = normalize(vLocal);
  vec3 seed = vec3(uSeed * 0.0131, uSeed * 0.0073, uSeed * 0.0197);
  float broad = fbm(p * 2.3 + seed);
  vec3 warp = vec3(noise3(p*3.0+seed), noise3(p*3.0+seed+17.0), noise3(p*3.0+seed+31.0));
  float elevation = fbm(p * 3.5 + warp * 1.5 + seed);
  float fine = fbm(p * 35.0 + seed);
  float sea = 0.23 + uWater * 0.42;
  float nearest = -2.0;
  float second = -2.0;
  vec3 regionColor = vec3(0.45,0.65,0.60);
  float cities = 0.0;
  float capital = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= uCityCount) break;
    float proximity = dot(p, uCityDirections[i]);
    if (proximity > nearest) {
      second = nearest;
      nearest = proximity;
      regionColor = uCityColors[i];
    } else if (proximity > second) second = proximity;
    // A settlement occupies an actual land patch in this schematic terrain.
    float settlementLand = smoothstep(0.965,0.997,proximity);
    elevation = mix(elevation, max(elevation, sea + 0.035), settlementLand);
    float spread = smoothstep(0.985 - uCitySizes[i]*0.008,0.9998,proximity);
    float streetNoise = step(0.68,noise3(p*370.0+seed));
    cities += spread * streetNoise * uCitySizes[i];
    capital += smoothstep(0.9997,0.99997,proximity);
  }
  float land = smoothstep(sea - 0.004, sea + 0.009, elevation);
  float shore = smoothstep(sea - 0.032, sea, elevation);
  float latitude = abs(p.y);
  float desert = smoothstep(0.40,0.67,fbm(p*8.0+seed+41.0)) * (1.0-smoothstep(0.6,0.85,latitude));
  float mountains = smoothstep(sea+0.11, sea+0.23, elevation);
  float ice = smoothstep(0.78 + clamp(uTemperature,-50.0,50.0)*0.0015,0.99,latitude + fine*0.06);
  vec3 ocean = mix(vec3(0.018,0.055,0.075),vec3(0.075,0.20,0.23),shore*0.65);
  ocean += fine*0.018;
  vec3 terrain = mix(vec3(0.17,0.27,0.18),vec3(0.34,0.37,0.23),fine);
  terrain = mix(terrain,vec3(0.51,0.40,0.27),desert*0.75);
  terrain = mix(terrain,vec3(0.38,0.38,0.34),mountains);
  terrain *= 0.78 + fine*0.47;
  vec3 color = mix(ocean, terrain,land);
  color = mix(color,vec3(0.73,0.80,0.79),ice*0.92);

  // 1: ocean, 2: desert, 3: gas, 4: ice, 0: rock / temperate.
  if (uKind > 1.5 && uKind < 2.5) {
    color = mix(uBaseColor*0.29,uBaseColor*0.92,0.25+elevation*0.70);
    color *= 0.78 + fine*0.45;
    color = mix(color,vec3(0.68,0.61,0.51),ice*0.5);
  } else if (uKind > 2.5 && uKind < 3.5) {
    float band = sin(p.y * 41.0 + fbm(p*9.0+seed)*7.0);
    float filament = fbm(vec3(p.x*21.0,p.y*80.0,p.z*21.0)+seed);
    color = mix(uBaseColor*0.48, mix(uBaseColor,vec3(0.82,0.76,0.65),0.48), band*0.5+0.5);
    color *= 0.77+filament*0.39;
    cities = 0.0;
  } else if (uKind > 3.5) {
    color = mix(uBaseColor*0.47,vec3(0.68,0.77,0.80),elevation);
    float cracks = smoothstep(0.44,0.46,abs(sin(broad*29.0+fine*0.6)));
    color *= 0.75+cracks*0.25;
  } else if (uHasAtmosphere < 0.5 && uWater < 0.08) {
    color = uBaseColor*(0.35+elevation*0.8)*(0.75+fine*0.45);
  }

  if (uLayer > 0.5 && uLayer < 1.5 && uCityCount > 0) {
    float border = 1.0-smoothstep(0.0,0.012,nearest-second);
    color = mix(color,regionColor*0.60,land*0.58);
    color += regionColor*border*land*0.45;
    color += vec3(0.83,0.85,0.73)*capital*0.8;
  }
  if (uLayer > 1.5) {
    float temp = clamp((uTemperature + 32.0 - latitude*53.0 - mountains*18.0)/65.0,0.0,1.0);
    vec3 cold = vec3(0.13,0.37,0.48);
    vec3 mild = vec3(0.51,0.57,0.38);
    vec3 hot = vec3(0.72,0.35,0.20);
    vec3 heat = temp < 0.5 ? mix(cold,mild,temp*2.0) : mix(mild,hot,(temp-0.5)*2.0);
    color = mix(color,heat,0.72);
  }

  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(uLight);
  vec3 viewDir = normalize(cameraPosition-vWorld);
  float ndl = dot(n,lightDir);
  float day = smoothstep(-0.10,0.30,ndl);
  float diffuse = max(0.0,ndl);
  vec3 lighting = vec3(0.027,0.037,0.048) + vec3(1.10,1.06,0.97)*diffuse;
  vec3 result = color*lighting;
  float spec = pow(max(dot(n,normalize(lightDir+viewDir)),0.0),76.0)*(1.0-land)*day;
  result += vec3(0.44,0.55,0.61)*spec*0.65;
  float edge = pow(1.0-max(dot(n,viewDir),0.0),3.7);
  result += vec3(0.085,0.24,0.37)*edge*day*uHasAtmosphere*0.33;
  result += vec3(1.0,0.62,0.22)*cities*(1.0-day)*0.75;
  gl_FragColor = vec4(result,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const cloudFragment = /* glsl */ `
precision highp float;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWorld;
uniform float uSeed;
uniform float uYear;
uniform vec3 uLight;
${noise}
void main() {
  vec3 p = normalize(vLocal);
  vec3 seed = vec3(uSeed*0.0131,uSeed*0.0073,uSeed*0.0197);
  float drift = uYear*0.003;
  vec3 shifted = vec3(p.x*cos(drift)-p.z*sin(drift),p.y,p.x*sin(drift)+p.z*cos(drift));
  float weather = fbm(shifted*6.0+seed+vec3(15.0));
  float streak = fbm(vec3(shifted.x*22.0,shifted.y*11.0,shifted.z*22.0)+seed);
  float clouds = smoothstep(0.45,0.69,weather+streak*0.16);
  float polar = smoothstep(0.75,1.0,abs(p.y))*0.18;
  float day = max(dot(normalize(vNormal),normalize(uLight)),0.0);
  vec3 color = vec3(0.78,0.83,0.84)*(0.06+day*0.96);
  gl_FragColor = vec4(color,(clouds+polar)*0.79);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const atmosphereFragment = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorld;
uniform vec3 uLight;
uniform vec3 uColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDirection = normalize(cameraPosition-vWorld);
  float rim = pow(max(0.0,1.0-abs(dot(n,viewDirection))),3.5);
  float sun = smoothstep(-0.30,0.65,dot(n,normalize(uLight)));
  gl_FragColor = vec4(uColor,rim*(0.10+sun*0.56));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const starFragment = /* glsl */ `
precision highp float;
varying vec3 vLocal;
uniform vec3 uColor;
uniform float uSeed;
${noise}
void main() {
  float granulation = fbm(normalize(vLocal)*45.0+uSeed);
  vec3 color = mix(uColor,vec3(1.0,0.92,0.70),0.6)*(1.5+granulation*0.8);
  gl_FragColor = vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
