// Persistent user settings + graphics quality presets.
const KEY = 'bwm.settings.v1';

export const QUALITY = {
  low: {
    label: 'Low', pixelRatioCap: 1, msaa: 0, shadowSize: 512, texRes: 512,
    bloom: false, lightPool: 3, volumetric: true, dust: 150, rainDrops: 1500,
    drawDistance: 26, physical: false, anisotropy: 2, grain: true,
  },
  medium: {
    label: 'Medium', pixelRatioCap: 1.25, msaa: 4, shadowSize: 1024, texRes: 1024,
    bloom: true, lightPool: 4, volumetric: true, dust: 300, rainDrops: 3000,
    drawDistance: 32, physical: false, anisotropy: 4, grain: true,
  },
  high: {
    label: 'High', pixelRatioCap: 2, msaa: 4, shadowSize: 2048, texRes: 1024,
    bloom: true, lightPool: 6, volumetric: true, dust: 500, rainDrops: 5000,
    drawDistance: 40, physical: true, anisotropy: 8, grain: true,
  },
  max: {
    label: 'Max', pixelRatioCap: 3, msaa: 8, shadowSize: 4096, texRes: 2048,
    bloom: true, lightPool: 8, volumetric: true, dust: 800, rainDrops: 8000,
    drawDistance: 50, physical: true, anisotropy: 16, grain: true,
  },
};

const DEFAULTS = {
  quality: 'high',
  master: 0.85,
  music: 0.6,
  sfx: 0.9,
  voice: 1.0,
  sensitivity: 1.0,
  fov: 78,
  invertY: false,
  brightness: 1.0,
  headBob: true,
  showFps: false,
  subtitles: true,
  voiceChat: false,
  voiceMode: 'ptt',   // 'ptt' | 'open'
  playerName: '',
  profile: -1, // -1 = random
};

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (_) { /* storage blocked: defaults are fine */ }
  if (!QUALITY[settings.quality]) settings.quality = 'high';
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) { /* ignore */ }
}

export function quality() {
  return QUALITY[settings.quality] || QUALITY.high;
}
