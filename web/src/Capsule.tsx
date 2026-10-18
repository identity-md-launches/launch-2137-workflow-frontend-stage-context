import { useEffect, useRef } from "react";

/** A finite gathering of thoughts, followed by a quick seal when the vault opens. */
export function Capsule({ sealed }: { sealed: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sealedRef = useRef(sealed);
  sealedRef.current = sealed;
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const styles = getComputedStyle(canvas);
    const ink = styles.getPropertyValue("--ink").trim();
    const accent = styles.getPropertyValue("--accent").trim();
    const n = 148;
    let w = 0, h = 0, raf = 0;
    let started = performance.now();
    let snapStarted = started;
    let progress = media.matches ? 0.96 : 0;
    let from = progress;
    let lastSealed = sealedRef.current;
    const rand = mulberry(7);
    const dots = Array.from({ length: n }, (_, i) => ({ x: 0.08 + rand() * 0.84, y: 0.12 + rand() * 0.76, phase: rand() * Math.PI * 2, i }));

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const geometry = () => {
      const cw = Math.min(w * 0.76, h * 1.9);
      return { cw, ch: cw * 0.39 };
    };
    const target = (i: number) => {
      const { cw, ch } = geometry();
      const r = ch / 2, straight = cw - ch;
      let s = i / n * (2 * straight + 2 * Math.PI * r);
      const cx = w / 2, cy = h / 2;
      if (s < straight) return [cx - straight / 2 + s, cy - r];
      s -= straight;
      if (s < Math.PI * r) {
        const a = -Math.PI / 2 + s / r;
        return [cx + straight / 2 + Math.cos(a) * r, cy + Math.sin(a) * r];
      }
      s -= Math.PI * r;
      if (s < straight) return [cx + straight / 2 - s, cy + r];
      s -= straight;
      const a = Math.PI / 2 + s / r;
      return [cx - straight / 2 + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    const draw = (now: number) => {
      const open = sealedRef.current;
      if (open !== lastSealed) { from = progress; snapStarted = now; lastSealed = open; }
      const elapsed = now - started;
      const snap = Math.min(1, (now - snapStarted) / 420);
      const smooth = (x: number) => x * x * (3 - 2 * x);
      if (media.matches) progress = open ? 1 : 0.96;
      else if (open || from > 0.96) progress = from + ((open ? 1 : 0.96) - from) * smooth(snap);
      else progress = 0.96 * smooth(Math.min(1, elapsed / 4200));
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = ink;
      for (const d of dots) {
        const [tx, ty] = target(d.i);
        const drift = media.matches ? 0 : Math.sin(d.phase + now / 1400) * 7 * (1 - progress);
        const x = (d.x * w + drift) * (1 - progress) + tx * progress;
        const y = (d.y * h + drift) * (1 - progress) + ty * progress;
        ctx.beginPath(); ctx.arc(x, y, d.i % 11 === 0 ? 1.8 : 1.2, 0, Math.PI * 2); ctx.fill();
      }
      if (open) {
        const { ch } = geometry();
        ctx.fillStyle = accent;
        ctx.fillRect(w / 2 - 2, h / 2 - ch / 2 - 5, 4, ch + 10);
        ctx.beginPath(); ctx.arc(w / 2, h / 2, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(w / 2 - 4, h / 2); ctx.lineTo(w / 2 - 1, h / 2 + 3); ctx.lineTo(w / 2 + 5, h / 2 - 4); ctx.stroke();
      }
      return !media.matches && (open ? snap < 1 : elapsed < 4200 || from > 0.96 && snap < 1);
    };
    const loop = (now: number) => { if (draw(now)) raf = requestAnimationFrame(loop); else raf = 0; };
    const wake = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
    const change = () => { started = performance.now() - 4200; from = progress; snapStarted = performance.now(); wake(); };
    resize();
    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(canvas);
    media.addEventListener("change", change);
    kick.current = wake;
    if (media.matches) draw(performance.now()); else wake();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); media.removeEventListener("change", change); kick.current = () => {}; };
  }, []);

  useEffect(() => { kick.current(); }, [sealed]);
  return <canvas ref={ref} className="capsule" data-vault={sealed ? "open" : "closed"} aria-hidden="true" />;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
