let context: AudioContext | null = null;
let ambient: GainNode | null = null;
let oscillators: OscillatorNode[] = [];
export function setSound(enabled: boolean) {
  try {
    if (!enabled) { if (ambient && context) ambient.gain.setTargetAtTime(0, context.currentTime, .2); return; }
    context ??= new AudioContext(); void context.resume();
    if (!ambient) {
      ambient = context.createGain(); ambient.gain.value = 0; ambient.connect(context.destination);
      oscillators = [55, 82.41, 110.14].map(frequency => {
        const oscillator = context!.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        oscillator.connect(ambient!); oscillator.start(); return oscillator;
      });
    }
    ambient.gain.setTargetAtTime(.009, context.currentTime, .6);
  } catch { /* Audio availability does not affect the world. */ }
}
export function signalSound() {
  if (!context || context.state !== 'running' || !ambient || ambient.gain.value < .001) return;
  const tone = context.createOscillator(), gain = context.createGain();
  tone.frequency.setValueAtTime(659.25, context.currentTime); tone.frequency.setValueAtTime(440, context.currentTime + .13);
  gain.gain.setValueAtTime(.012, context.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .36);
  tone.connect(gain); gain.connect(context.destination); tone.start(); tone.stop(context.currentTime + .4);
}
export function disposeSound() { oscillators.forEach(o => o.stop()); oscillators = []; void context?.close(); context = null; ambient = null; }
