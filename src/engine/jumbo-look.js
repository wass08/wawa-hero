// Shared shader controls for stage, lab and photo capture. No extra camera.
export const JUMBO_LOOK = Object.freeze({
  current: Object.freeze({tones:5,rows:60,contrast:1.3,gamma:1,dotSoftness:.1,dotRadius:.4,dotFloor:.16,brightness:1,blackPoint:.06,localContrast:0,menuBrightness:.32,menuDesaturation:.2,scanWidth:.04,scanStrength:.25,scanSpeed:.16,pulseFloor:.82,flashStrength:.6,menuBlur:.012}),
  A: Object.freeze({tones:8,rows:90,contrast:1.16,gamma:.9,dotSoftness:.13,dotRadius:.44,dotFloor:.25,brightness:1,blackPoint:.035,localContrast:.15,menuBrightness:.32,menuDesaturation:.2,scanWidth:.04,scanStrength:.25,scanSpeed:.16,pulseFloor:.82,flashStrength:.6,menuBlur:.008}),
  live: Object.freeze({tones:10,rows:100,contrast:1.16,gamma:.9,dotSoftness:.13,dotRadius:.44,dotFloor:.25,brightness:1,blackPoint:.035,localContrast:.15,menuBrightness:.32,menuDesaturation:.2,scanWidth:.04,scanStrength:.25,scanSpeed:.16,pulseFloor:.82,flashStrength:.6,menuBlur:.008}),
  C: Object.freeze({tones:12,rows:130,contrast:1.16,gamma:.9,dotSoftness:.13,dotRadius:.44,dotFloor:.25,brightness:1,blackPoint:.035,localContrast:.15,menuBrightness:.32,menuDesaturation:.2,scanWidth:.04,scanStrength:.25,scanSpeed:.16,pulseFloor:.82,flashStrength:.6,menuBlur:.008}),
  photo: Object.freeze({tones:14,rows:160,contrast:1.13,gamma:.88,dotSoftness:.15,dotRadius:.45,dotFloor:.32,brightness:1.05,blackPoint:.025,localContrast:.2,menuBrightness:.32,menuDesaturation:.2,scanWidth:.04,scanStrength:.12,scanSpeed:.16,pulseFloor:.94,flashStrength:.3,menuBlur:.008}),
});
export const JUMBO_LIMITS={tones:[2,24,1],rows:[30,220,1],contrast:[.7,1.8,.01],gamma:[.5,1.5,.01],dotSoftness:[.01,.25,.01],brightness:[.5,1.5,.01]};
const LOOK_KEYS=Object.keys(JUMBO_LOOK.live);
export function normalizeJumboLook(look={}) {
  const result={...JUMBO_LOOK.live};
  for(const key of LOOK_KEYS)if(Number.isFinite(look[key]))result[key]=JUMBO_LIMITS[key]?Math.max(JUMBO_LIMITS[key][0],Math.min(JUMBO_LIMITS[key][1],look[key])):look[key];
  result.tones=Math.round(result.tones);result.rows=Math.round(result.rows);return result;
}
export function jumboUniforms(look=JUMBO_LOOK.live){return Object.fromEntries(Object.entries(normalizeJumboLook(look)).map(([k,value])=>[k,{value}]));}
export function applyJumboLook(uniforms,look){
  // Preset changes run for each lab viewport: no temporary entries/arrays.
  for(const key of LOOK_KEYS){let value=Number.isFinite(look[key])?look[key]:JUMBO_LOOK.live[key];const bounds=JUMBO_LIMITS[key];if(bounds)value=Math.max(bounds[0],Math.min(bounds[1],value));if(key==='tones'||key==='rows')value=Math.round(value);uniforms[key].value=value;}
}
export function readJumboLook(uniforms){const look={};for(const key of LOOK_KEYS)look[key]=uniforms[key].value;return look;}
export function palettePosition(l,tones){return Math.min(tones-1,Math.max(0,Math.floor(l*tones)))/(tones-1)*4;}
export const JUMBO_FRAGMENT=`
        varying vec2 vUv;
        uniform sampler2D feed, menuLayer;
        uniform float menuMix;
        uniform float tones, rows, contrast, gamma, dotSoftness, brightness, dotFloor, blackPoint, localContrast, dotRadius, menuBrightness, menuDesaturation, scanWidth, scanStrength, scanSpeed, pulseFloor, flashStrength, menuBlur;
        uniform float gammaIn, flip, srcAspect, wallAspect, time, pulse;
        uniform vec3 flash, r0, r1, r2, r3, r4, cUp, cDown, cClap;
        vec3 tone(float l) {
          float p=clamp(floor(clamp(l,0.0,1.0)*tones),0.0,tones-1.0)/(tones-1.0)*4.0;
          if(p<1.0)return mix(r0,r1,p);
          if(p<2.0)return mix(r1,r2,p-1.0);
          if(p<3.0)return mix(r2,r3,p-2.0);
          return mix(r3,r4,p-3.0);
        }
        void main() {
          float feedW = (16.0 / 9.0) / wallAspect, dx = vUv.x - 0.5;
          vec3 c;
          if (abs(dx) < feedW * 0.5) {
            vec2 g = vec2(rows * 16.0 / 9.0, rows);
            vec2 fuv = vec2((vUv.x - (0.5 - feedW * 0.5)) / feedW, vUv.y);
            vec2 cell = floor(fuv * g), f = fract(fuv * g), s = (cell + 0.5) / g;
            if (flip > 0.5) s.x = 1.0 - s.x;
            float k = (16.0 / 9.0) / srcAspect;
            if (k < 1.0) s.x = 0.5 + (s.x - 0.5) * k; else s.y = 0.5 + (s.y - 0.5) / k;
            vec3 sampleColor=texture2D(feed,s).rgb;
            if(menuMix>.5){vec2 blur=vec2(menuBlur,menuBlur);sampleColor=(sampleColor*2.0+texture2D(feed,s+blur).rgb+texture2D(feed,s-blur).rgb+texture2D(feed,s+vec2(blur.x,-blur.y)).rgb+texture2D(feed,s+vec2(-blur.x,blur.y)).rgb)/6.0;}
            float l = pow(dot(sampleColor, vec3(0.299, 0.587, 0.114)), gammaIn * gamma);
            // Two neighbouring cells add a small unsharp contrast boost, without
            // segmentation or dithering. The palette remains luminance-only.
            vec2 stepUV=vec2(1.0/g.x,0.0);
            float neighbour=pow(dot((texture2D(feed,s-stepUV).rgb+texture2D(feed,s+stepUV).rgb)*.5,vec3(.299,.587,.114)),gammaIn*gamma);
            l=clamp((l-blackPoint)*contrast+(l-neighbour)*localContrast,0.0,1.0);
            c = tone(l) + flash * smoothstep(0.35, 0.9, l) * flashStrength;
            float band = 1.0 - smoothstep(0.0, scanWidth, abs(fuv.y - fract(1.0 - time * scanSpeed)));
            c *= (1.0 + band * scanStrength) * (dotFloor + (1.0-dotFloor) * (1.0-smoothstep(dotRadius-dotSoftness,dotRadius+dotSoftness,length(f-.5))));
          } else {
            vec2 g = vec2(16.0 * wallAspect, 16.0);
            vec2 cell = floor(vUv * g), f = fract(vUv * g);
            float lv = 0.18 + 0.5 * abs(sin(time * 1.3 + cell.x * 0.55)) * (0.55 + 0.45 * sin(time * 0.7 + cell.x * 0.21)) + pulse * 0.25;
            float t = (cell.y + 0.5) / g.y;
            vec3 on = t < 0.45 ? cUp : t < 0.75 ? cDown : cClap;
            c = (t < lv ? on * 0.42 : r0 * 0.4) * smoothstep(0.62, 0.42, max(abs(f.x - 0.5), abs(f.y - 0.5)));
            if (abs(dx) < feedW * 0.5 + 0.006) c = r3 * 0.7;
          }
          c*=brightness*(pulseFloor+pulse*(1.0-pulseFloor));
          if(menuMix>.5){c=mix(c,r1*dot(c,vec3(.299,.587,.114))*2.0,menuDesaturation)*menuBrightness;vec4 ink=texture2D(menuLayer,vUv);c=mix(c,ink.rgb,ink.a);}
          gl_FragColor = vec4(c, 1.0);
        }`;
