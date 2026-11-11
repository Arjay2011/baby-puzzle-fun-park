/**
 * 音频模块：程序化合成音效 + 背景音乐 + 中文语音
 * 零素材依赖，全部由 Web Audio / SpeechSynthesis 实时生成。
 */

export const Audio2 = (() => {
  let ac = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let musicTimer = null;
  let musicStep = 0;
  let enabled = true;
  let unlocked = false;

  /** 必须在用户手势中调用，浏览器才允许播放声音 */
  function unlock() {
    if (unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(ac.destination);
      musicGain = ac.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(master);
      sfxGain = ac.createGain();
      sfxGain.gain.value = 0.4;
      sfxGain.connect(master);
      unlocked = true;
      if (ac.state === 'suspended') ac.resume();
    } catch (e) {
      console.warn('音频初始化失败', e);
    }
  }

  function now() { return ac ? ac.currentTime : 0; }

  /** 单个音：波形 + 频率包络 + 音量包络 */
  function tone(freq, dur = 0.12, type = 'sine', vol = 0.3, delay = 0, dest = null) {
    if (!ac || !enabled) return;
    const t0 = now() + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest || sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 频率滑音，用于「吸住」的音效 */
  function slide(f0, f1, dur = 0.18, type = 'sine', vol = 0.3, delay = 0) {
    if (!ac || !enabled) return;
    const t0 = now() + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 白噪声，用于轻柔的「哒」声 */
  function noise(dur = 0.08, vol = 0.2, freq = 1400, delay = 0) {
    if (!ac || !enabled) return;
    const t0 = now() + delay;
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(sfxGain);
    src.start(t0);
  }

  /* ---------------- 音效 ---------------- */

  const sfx = {
    /** 拿起拼块：轻快的「啵」 */
    pick() { slide(420, 720, 0.11, 'sine', 0.22); noise(0.05, 0.08, 2200); },
    /** 放下但没对准：闷闷的一声 */
    drop() { tone(200, 0.09, 'sine', 0.16); noise(0.05, 0.06, 700); },
    /** 吸附成功：清脆的双音「叮」 */
    snap() {
      tone(880, 0.16, 'sine', 0.26);
      tone(1320, 0.22, 'sine', 0.16, 0.045);
      noise(0.04, 0.05, 3200);
    },
    /** 拼完一块的庆祝音 */
    complete() {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.3, 'triangle', 0.24, i * 0.08));
    },
    /** 通关小号声 */
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone(f, 0.34, 'triangle', 0.26, i * 0.13);
        tone(f * 2, 0.2, 'sine', 0.1, i * 0.13);
      });
    },
    /** 星星出现 */
    star(i = 0) {
      tone(1046 + i * 220, 0.22, 'sine', 0.24, i * 0.13);
      tone(1568 + i * 220, 0.18, 'sine', 0.12, i * 0.13 + 0.04);
    },
    /** 按钮点击 */
    tap() { tone(660, 0.07, 'triangle', 0.18); },
    /** 页面切换 */
    swap() { slide(520, 780, 0.12, 'triangle', 0.15); },
  };

  /* ---------------- 背景音乐 ---------------- */
  /* 轻柔的八音盒式循环，用五声音阶避免任何旋律版权问题 */
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 880.0, 783.99];
  const BASS = [261.63, 293.66, 329.63, 392.0];
  const LOOP_LEN = 32;

  function playMusicStep(step) {
    if (!ac || !enabled) return;
    const i = step % LOOP_LEN;
    // 主旋律：每 4 步一个音
    if (i % 4 === 0) {
      const n = SCALE[(step / 4 | 0) % SCALE.length];
      tone(n, 0.42, 'sine', 0.5, 0, musicGain);
      tone(n * 2, 0.2, 'sine', 0.16, 0.01, musicGain);
    }
    // 低音：每 8 步一个
    if (i % 8 === 0) {
      const b = BASS[(step / 8 | 0) % BASS.length];
      tone(b, 0.7, 'triangle', 0.4, 0, musicGain);
    }
  }

  function musicTick() {
    if (!ac || !enabled) return;
    playMusicStep(musicStep);
    musicStep++;
  }

  const music = {
    start() {
      if (!unlocked || musicTimer) return;
      musicStep = 0;
      playMusicStep(musicStep++);
      musicTimer = setInterval(musicTick, 460);
    },
    stop() {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    },
  };

  /* ---------------- 中文语音 ---------------- */

  const voice = {
    enabled: true,
    _voice: null,
    _init() {
      if (this._voice !== null) return;
      this._voice = false;
      try {
        const pick = () => {
          const vs = speechSynthesis.getVoices();
          if (!vs || !vs.length) return;
          // 优先选择中文普通话女声
          this._voice = vs.find(v => /zh[-_]?CN/i.test(v.lang) && /female|女|Tingting|Yaoyao/i.test(v.name))
            || vs.find(v => /zh[-_]?CN/i.test(v.lang))
            || vs.find(v => /^zh/i.test(v.lang))
            || false;
        };
        pick();
        if (speechSynthesis.onvoiceschanged !== undefined) {
          speechSynthesis.onvoiceschanged = pick;
        }
      } catch (e) {
        this._voice = false;
      }
    },
    /** 说一句话；rate 调慢一点更适合幼儿 */
    say(text, rate = 0.85, pitch = 1.15) {
      if (!this.enabled || !text) return;
      this._init();
      try {
        if (!('speechSynthesis' in window)) return;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = rate;
        u.pitch = pitch;
        u.volume = 1;
        if (this._voice && this._voice !== false) u.voice = this._voice;
        speechSynthesis.speak(u);
      } catch (e) {
        /* 语音不可用时静默降级 */
      }
    },
    stop() {
      try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
  };

  return {
    unlock,
    sfx,
    music,
    voice,
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = v;
      if (!v) music.stop();
    },
    setVoiceEnabled(v) {
      voice.enabled = v;
      if (!v) voice.stop();
    },
    get voiceEnabled() { return voice.enabled; },
  };
})();
