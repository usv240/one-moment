// Microphone capture for One Moment.
//
// Browsers capture at 44.1 or 48kHz Float32. AssemblyAI realtime wants 16kHz
// PCM16 (the Voice Agent leg wants 24kHz), in 50 to 1000ms frames, no faster
// than real time. MediaRecorder cannot produce raw PCM, so this runs as an
// AudioWorklet on the audio thread.
//
// Downsampling uses a box filter (the mean of each input window) rather than
// picking every Nth sample, which would alias high frequencies into the speech
// band and cost recognition accuracy.

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.ratio = sampleRate / target;
    this.frameSamples = Math.round(target * 0.05);
    this.out = new Int16Array(this.frameSamples);
    this.n = 0;
    this.acc = 0;
    this.accCount = 0;
    this.phase = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.accCount++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        let s = this.acc / this.accCount;
        this.acc = 0;
        this.accCount = 0;
        if (s > 1) s = 1; else if (s < -1) s = -1;
        this.sumSq += s * s;
        this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.frameSamples) {
          const rms = Math.sqrt(this.sumSq / this.frameSamples);
          this.port.postMessage({ pcm: this.out.buffer.slice(0), rms });
          this.n = 0;
          this.sumSq = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
