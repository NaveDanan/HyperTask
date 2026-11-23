import { useEffect, useRef, type RefObject } from 'react';
import { sampleHyperVoiceSpectrum } from '../speech/browserPcmCapture';

export type HyperVoiceSpherePhase =
  | 'idle'
  | 'needs-setup'
  | 'preparing'
  | 'listening'
  | 'transcribing'
  | 'parsing'
  | 'confirming'
  | 'executing'
  | 'done'
  | 'error';

export interface HyperVoiceSphereProps {
  readonly phase: HyperVoiceSpherePhase;
  readonly analyserRef?: RefObject<AnalyserNode | null>;
  readonly levelRef?: RefObject<number>;
  readonly size?: number;
  readonly onClick?: () => void;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

interface SpherePalette {
  coreInner: [number, number, number];
  coreMid: [number, number, number];
  coreOuter: [number, number, number];
  ringA: [number, number, number];
  ringB: [number, number, number];
  ringC: [number, number, number];
  halo: [number, number, number];
  spinSpeed: number;
  pulseBase: number;
}

const PALETTES: Record<HyperVoiceSpherePhase, SpherePalette> = {
  idle: {
    coreInner: [196, 232, 255],
    coreMid: [79, 134, 247],
    coreOuter: [58, 42, 145],
    ringA: [96, 185, 255],
    ringB: [148, 120, 255],
    ringC: [64, 224, 208],
    halo: [88, 130, 255],
    spinSpeed: 0.45,
    pulseBase: 0.08,
  },
  'needs-setup': {
    coreInner: [224, 231, 255],
    coreMid: [110, 120, 230],
    coreOuter: [56, 52, 118],
    ringA: [140, 160, 255],
    ringB: [180, 140, 245],
    ringC: [120, 200, 240],
    halo: [110, 125, 245],
    spinSpeed: 0.3,
    pulseBase: 0.05,
  },
  preparing: {
    coreInner: [216, 246, 255],
    coreMid: [56, 189, 248],
    coreOuter: [79, 70, 229],
    ringA: [56, 224, 255],
    ringB: [167, 139, 250],
    ringC: [99, 102, 241],
    halo: [56, 189, 248],
    spinSpeed: 1.15,
    pulseBase: 0.14,
  },
  listening: {
    coreInner: [232, 255, 255],
    coreMid: [34, 211, 238],
    coreOuter: [99, 64, 244],
    ringA: [34, 238, 255],
    ringB: [192, 112, 255],
    ringC: [56, 168, 255],
    halo: [56, 205, 255],
    spinSpeed: 1.35,
    pulseBase: 0.16,
  },
  transcribing: {
    coreInner: [236, 233, 255],
    coreMid: [129, 110, 255],
    coreOuter: [49, 46, 180],
    ringA: [168, 128, 255],
    ringB: [56, 210, 255],
    ringC: [236, 120, 255],
    halo: [139, 92, 246],
    spinSpeed: 2.3,
    pulseBase: 0.15,
  },
  parsing: {
    coreInner: [236, 233, 255],
    coreMid: [139, 92, 246],
    coreOuter: [55, 48, 163],
    ringA: [192, 132, 252],
    ringB: [56, 189, 248],
    ringC: [129, 140, 248],
    halo: [139, 92, 246],
    spinSpeed: 2.55,
    pulseBase: 0.16,
  },
  confirming: {
    coreInner: [224, 242, 254],
    coreMid: [99, 102, 241],
    coreOuter: [55, 48, 140],
    ringA: [129, 168, 255],
    ringB: [167, 139, 250],
    ringC: [56, 189, 248],
    halo: [99, 102, 241],
    spinSpeed: 0.55,
    pulseBase: 0.08,
  },
  executing: {
    coreInner: [220, 252, 245],
    coreMid: [20, 184, 166],
    coreOuter: [59, 80, 214],
    ringA: [45, 212, 191],
    ringB: [96, 165, 250],
    ringC: [167, 139, 250],
    halo: [20, 184, 166],
    spinSpeed: 2.0,
    pulseBase: 0.13,
  },
  done: {
    coreInner: [236, 253, 245],
    coreMid: [34, 197, 94],
    coreOuter: [15, 118, 110],
    ringA: [74, 222, 128],
    ringB: [45, 212, 191],
    ringC: [134, 239, 172],
    halo: [34, 197, 94],
    spinSpeed: 0.65,
    pulseBase: 0.12,
  },
  error: {
    coreInner: [255, 237, 213],
    coreMid: [249, 115, 22],
    coreOuter: [185, 28, 28],
    ringA: [251, 146, 60],
    ringB: [248, 113, 113],
    ringC: [253, 186, 116],
    halo: [239, 68, 68],
    spinSpeed: 0.5,
    pulseBase: 0.1,
  },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(
  current: [number, number, number],
  target: [number, number, number],
  t: number,
): void {
  current[0] = lerp(current[0], target[0], t);
  current[1] = lerp(current[1], target[1], t);
  current[2] = lerp(current[2], target[2], t);
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha.toFixed(3)})`;
}

interface OrbitParticle {
  readonly theta0: number;
  readonly phi0: number;
  readonly speed: number;
  readonly radiusMul: number;
  readonly size: number;
  readonly binIndex: number;
}

const PARTICLE_COUNT = 26;
const BIN_COUNT = 32;

const PARTICLES: readonly OrbitParticle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
  theta0: (i / PARTICLE_COUNT) * Math.PI * 2,
  phi0: Math.acos(1 - (2 * (i + 0.5)) / PARTICLE_COUNT),
  speed: 0.45 + (i % 5) * 0.18,
  radiusMul: 0.88 + (i % 4) * 0.085,
  size: 1.15 + (i % 3) * 0.65,
  binIndex: i % BIN_COUNT,
}));

/**
 * High-DPI HTML5 canvas intelligent spinning voice sphere.
 * Reads live Web Audio AnalyserNode frequency/amplitude bands in a 60fps requestAnimationFrame
 * loop without triggering React re-renders, and renders cleanly on transparent frameless windows.
 */
export function HyperVoiceSphere({
  phase,
  analyserRef,
  levelRef,
  size = 156,
  onClick,
  ariaLabel,
  disabled = false,
  className = '',
}: HyperVoiceSphereProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<HyperVoiceSpherePhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = motionQuery?.matches ?? false;
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
    };
    motionQuery?.addEventListener?.('change', onMotionChange);

    const initial = PALETTES[phaseRef.current];
    const currentPalette = {
      coreInner: [...initial.coreInner] as [number, number, number],
      coreMid: [...initial.coreMid] as [number, number, number],
      coreOuter: [...initial.coreOuter] as [number, number, number],
      ringA: [...initial.ringA] as [number, number, number],
      ringB: [...initial.ringB] as [number, number, number],
      ringC: [...initial.ringC] as [number, number, number],
      halo: [...initial.halo] as [number, number, number],
      spinSpeed: initial.spinSpeed,
      pulseBase: initial.pulseBase,
    };

    let freqBuf: Uint8Array<ArrayBuffer> | null = null;
    let timeBuf: Uint8Array<ArrayBuffer> | null = null;
    const rawBins = new Float32Array(BIN_COUNT);
    const smoothBins = new Float32Array(BIN_COUNT);
    let smoothRms = 0;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothTreble = 0;
    let spinAngle = 0;
    let rafId = 0;
    let lastTime = performance.now();

    const syncResolution = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const px = Math.round(size * dpr);
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncResolution();

    const drawRibbon = (
      cx: number,
      cy: number,
      baseRadius: number,
      tiltX: number,
      tiltY: number,
      spin: number,
      color: readonly [number, number, number],
      alpha: number,
      lineWidth: number,
      ampScale: number,
      binOffset: number,
    ) => {
      const steps = 84;
      const cosX = Math.cos(tiltX);
      const sinX = Math.sin(tiltX);
      const cosY = Math.cos(tiltY);
      const sinY = Math.sin(tiltY);

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const binIdx = (Math.floor((i / steps) * BIN_COUNT) + binOffset) % BIN_COUNT;
        const binVal = smoothBins[binIdx] ?? 0;
        const wave =
          Math.sin(t * 3 + spin * 2.1) * (1.2 + smoothMid * 6.5) * ampScale +
          Math.cos(t * 5 - spin * 1.4) * (0.8 + smoothTreble * 5.0) * ampScale +
          binVal * 11 * ampScale;
        const r = baseRadius + wave;
        const x0 = Math.cos(t + spin) * r;
        const y0 = Math.sin(t + spin) * r;
        const z0 = Math.sin(t * 2 + spin * 1.5) * (4 + smoothBass * 8) * ampScale;

        // 3D tilt around X then Y
        const y1 = y0 * cosX - z0 * sinX;
        const z1 = y0 * sinX + z0 * cosX;
        const x2 = x0 * cosY + z1 * sinY;
        const z2 = -x0 * sinY + z1 * cosY;

        const perspective = 1 / (1 - z2 / (size * 2.4));
        const px = cx + x2 * perspective;
        const py = cy + y1 * perspective;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };

    const render = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      syncResolution();

      const activePhase = phaseRef.current;
      const target = PALETTES[activePhase];
      const colorLerp = Math.min(1, dt * 6.5);
      lerpRgb(currentPalette.coreInner, target.coreInner, colorLerp);
      lerpRgb(currentPalette.coreMid, target.coreMid, colorLerp);
      lerpRgb(currentPalette.coreOuter, target.coreOuter, colorLerp);
      lerpRgb(currentPalette.ringA, target.ringA, colorLerp);
      lerpRgb(currentPalette.ringB, target.ringB, colorLerp);
      lerpRgb(currentPalette.ringC, target.ringC, colorLerp);
      lerpRgb(currentPalette.halo, target.halo, colorLerp);
      currentPalette.spinSpeed = lerp(currentPalette.spinSpeed, target.spinSpeed, colorLerp);
      currentPalette.pulseBase = lerp(currentPalette.pulseBase, target.pulseBase, colorLerp);

      let rms = 0;
      let bass = 0;
      let mid = 0;
      let treble = 0;

      const analyser = analyserRef?.current ?? null;
      if (analyser && activePhase === 'listening') {
        if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
          freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }
        if (!timeBuf || timeBuf.length !== analyser.fftSize) {
          timeBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        }
        const sample = sampleHyperVoiceSpectrum(analyser, freqBuf, timeBuf, rawBins);
        rms = sample.rms;
        bass = sample.bass;
        mid = sample.mid;
        treble = sample.treble;
      } else {
        const scalar = activePhase === 'listening' ? Math.max(0, Math.min(1, levelRef?.current ?? 0)) : 0;
        rms = scalar;
        bass = scalar * 0.9;
        mid = scalar * 0.75;
        treble = scalar * 0.6;
        for (let i = 0; i < BIN_COUNT; i++) {
          rawBins[i] =
            scalar > 0.01
              ? scalar * (0.55 + 0.45 * Math.sin(now * 0.01 + i * 0.65))
              : 0;
        }
      }

      const attack = Math.min(1, dt * 16);
      const release = Math.min(1, dt * 7);
      smoothRms = lerp(smoothRms, rms, rms > smoothRms ? attack : release);
      smoothBass = lerp(smoothBass, bass, bass > smoothBass ? attack : release);
      smoothMid = lerp(smoothMid, mid, mid > smoothMid ? attack : release);
      smoothTreble = lerp(smoothTreble, treble, treble > smoothTreble ? attack : release);
      for (let i = 0; i < BIN_COUNT; i++) {
        const v = rawBins[i] ?? 0;
        smoothBins[i] = lerp(smoothBins[i]!, v, v > smoothBins[i]! ? attack : release);
      }

      const speedBoost = activePhase === 'listening' ? 1 + smoothRms * 2.4 + smoothMid * 1.4 : 1;
      if (!reducedMotion) {
        spinAngle += dt * currentPalette.spinSpeed * speedBoost;
      }

      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = size * 0.31;
      const breathe = reducedMotion ? 0 : Math.sin(spinAngle * 1.7) * baseRadius * currentPalette.pulseBase * 0.45;
      const reactiveExpand = baseRadius * (smoothRms * 0.24 + smoothBass * 0.14);
      const coreRadius = baseRadius + breathe + reactiveExpand;

      // 1. Outer ambient halo bloom
      const haloRadius = coreRadius * (1.72 + smoothRms * 0.35);
      const haloGrad = ctx.createRadialGradient(cx, cy, coreRadius * 0.35, cx, cy, haloRadius);
      haloGrad.addColorStop(0, rgba(currentPalette.halo, 0.38 + smoothRms * 0.28));
      haloGrad.addColorStop(0.55, rgba(currentPalette.ringB, 0.14 + smoothMid * 0.16));
      haloGrad.addColorStop(1, rgba(currentPalette.halo, 0));
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2. Back orbital particles (z < 0)
      const particlePoints: Array<{ x: number; y: number; z: number; r: number; alpha: number }> = [];
      for (const p of PARTICLES) {
        const theta = p.theta0 + spinAngle * p.speed;
        const phi = p.phi0 + (reducedMotion ? 0 : Math.sin(spinAngle * 0.8 + p.theta0) * 0.22);
        const binBoost = (smoothBins[p.binIndex] ?? 0) * baseRadius * 0.34;
        const rad = coreRadius * p.radiusMul + binBoost + 5;
        const x = rad * Math.sin(phi) * Math.cos(theta);
        const y = rad * Math.cos(phi);
        const z = rad * Math.sin(phi) * Math.sin(theta);
        const depth = (z / Math.max(1, rad) + 1) / 2;
        particlePoints.push({
          x: cx + x,
          y: cy + y,
          z,
          r: p.size * (0.65 + depth * 0.65 + smoothTreble * 0.4),
          alpha: 0.2 + depth * 0.65,
        });
      }
      for (const pt of particlePoints) {
        if (pt.z >= 0) continue;
        ctx.fillStyle = rgba(currentPalette.ringA, pt.alpha * 0.65);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Wave-deformed luminous core
      const coreSegments = 72;
      const deformStrength = reducedMotion
        ? 0
        : (activePhase === 'listening' ? 1.0 : 0.32) * (1 + smoothRms * 2.2);
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= coreSegments; i++) {
        const angle = (i / coreSegments) * Math.PI * 2;
        const binIdx = Math.floor((i / coreSegments) * BIN_COUNT) % BIN_COUNT;
        const binAmp = smoothBins[binIdx] ?? 0;
        const harmonic =
          Math.sin(angle * 3 + spinAngle * 2.4) * (1.1 + smoothBass * 4.2) +
          Math.cos(angle * 5 - spinAngle * 1.9) * (0.7 + smoothMid * 3.2) +
          binAmp * 7.5;
        const r = coreRadius + harmonic * deformStrength;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      const lightX = cx - coreRadius * 0.28 + (reducedMotion ? 0 : Math.cos(spinAngle) * 4);
      const lightY = cy - coreRadius * 0.32 + (reducedMotion ? 0 : Math.sin(spinAngle * 0.9) * 4);
      const coreGrad = ctx.createRadialGradient(lightX, lightY, coreRadius * 0.08, cx, cy, coreRadius * 1.15);
      coreGrad.addColorStop(0, rgba(currentPalette.coreInner, 0.98));
      coreGrad.addColorStop(0.42, rgba(currentPalette.coreMid, 0.94));
      coreGrad.addColorStop(0.86, rgba(currentPalette.coreOuter, 0.96));
      coreGrad.addColorStop(1, rgba(currentPalette.ringA, 0.72));
      ctx.fillStyle = coreGrad;
      ctx.fill();

      // Clip interior swirl & meridian sheen inside core
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const swirlAngle = spinAngle * (1.1 + i * 0.45) + i * ((Math.PI * 2) / 3);
        const sx = cx + Math.cos(swirlAngle) * coreRadius * 0.34;
        const sy = cy + Math.sin(swirlAngle * 1.2) * coreRadius * 0.32;
        const swirlR = coreRadius * (0.62 + smoothMid * 0.25);
        const swirlGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, swirlR);
        const swirlColor = i === 0 ? currentPalette.ringA : i === 1 ? currentPalette.ringB : currentPalette.ringC;
        swirlGrad.addColorStop(0, rgba(swirlColor, 0.32 + smoothRms * 0.25));
        swirlGrad.addColorStop(1, rgba(swirlColor, 0));
        ctx.fillStyle = swirlGrad;
        ctx.beginPath();
        ctx.arc(sx, sy, swirlR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Specular glass crescent highlight
      const specGrad = ctx.createRadialGradient(
        cx - coreRadius * 0.34,
        cy - coreRadius * 0.38,
        coreRadius * 0.02,
        cx - coreRadius * 0.24,
        cy - coreRadius * 0.26,
        coreRadius * 0.65,
      );
      specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
      specGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.14)');
      specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = specGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Crisp inner glass rim
      ctx.strokeStyle = rgba(currentPalette.coreInner, 0.42 + smoothRms * 0.32);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 0.99, 0, Math.PI * 2);
      ctx.stroke();

      // 4. Three tilted 3D-projected orbital energy ribbons
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const ampScale = reducedMotion ? 0.15 : activePhase === 'listening' ? 0.95 : 0.45;
      drawRibbon(
        cx,
        cy,
        coreRadius * 1.14,
        1.08 + Math.sin(spinAngle * 0.45) * 0.18,
        0.42 + spinAngle * 0.25,
        spinAngle * 1.2,
        currentPalette.ringA,
        0.58 + smoothRms * 0.32,
        1.75 + smoothMid * 1.1,
        ampScale,
        0,
      );
      drawRibbon(
        cx,
        cy,
        coreRadius * 1.22,
        -0.96 + Math.cos(spinAngle * 0.38) * 0.2,
        -0.55 - spinAngle * 0.22,
        -spinAngle * 0.95,
        currentPalette.ringB,
        0.48 + smoothMid * 0.32,
        1.45 + smoothTreble * 0.95,
        ampScale,
        10,
      );
      drawRibbon(
        cx,
        cy,
        coreRadius * 1.08,
        0.42 + Math.sin(spinAngle * 0.62) * 0.26,
        1.15 + spinAngle * 0.18,
        spinAngle * 1.55,
        currentPalette.ringC,
        0.42 + smoothTreble * 0.36,
        1.2 + smoothBass * 0.85,
        ampScale,
        20,
      );

      // 5. Front orbital particles (z >= 0)
      for (const pt of particlePoints) {
        if (pt.z < 0) continue;
        ctx.fillStyle = rgba(currentPalette.coreInner, Math.min(1, pt.alpha + smoothRms * 0.25));
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(rafId);
      motionQuery?.removeEventListener?.('change', onMotionChange);
    };
  }, [analyserRef, levelRef, size]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="hyper-voice-sphere"
      data-phase={phase}
      className={`hva-sphere-btn ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="hva-sphere-canvas"
        style={{ width: size, height: size }}
      />
    </button>
  );
}
