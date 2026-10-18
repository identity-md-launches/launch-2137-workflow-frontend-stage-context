import { useEffect, useRef } from "react";

/**
 * The home centrepiece: dots drift loosely; when the vault opens they gather into a sealed
 * capsule. Under reduced motion it draws the current state once and never animates.
 */
export function Capsule({ sealed }: { sealed: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sealedRef = useRef(sealed);
  sealedRef.current = sealed;
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const N = 140;
    let w = 0;
    let h = 0;
    let raf = 0;
    const rand = mulberry(7);
    const dots = Array.from({ length: N }, (_, i) => ({ x: rand(), y: rand(), vx: (rand() - 0.5) * 0.0012, vy: (rand() - 0.5) * 0.0012, i }));

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // A point on the capsule outline (a stadium) for dot i, in canvas pixels.
    const target = (i: number) => {
      const cw = Math.min(w * 0.62, h * 1.5);
      const ch = Math.min(h * 0.46, cw * 0.42);
      const r = ch / 2;
      const straight = cw - ch;
      const perim = 2 * straight + 2 * Math.PI * r;
      let s = (i / N) * perim;
      const cx = w / 2;
      const cy = h / 2;
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

    let settle = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const sealedNow = sealedRef.current;
      settle = reduce ? (sealedNow ? 1 : 0) : Math.max(0, Math.min(1, settle + (sealedNow ? 0.02 : -0.03)));
      const e = settle * settle * (3 - 2 * settle);
      for (const d of dots) {
        if (!reduce) {
          d.x += d.vx;
          d.y += d.vy;
          if (d.x < 0 || d.x > 1) d.vx *= -1;
          if (d.y < 0 || d.y > 1) d.vy *= -1;
        }
        const [tx, ty] = target(d.i);
        const x = d.x * w * (1 - e) + tx * e;
        const y = d.y * h * (1 - e) + ty * e;
        ctx.fillStyle = d.i % 23 === 0 ? "#FF5B2E" : "#0F1A26";
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      if (e > 0.98) {
        // The seal: one accent bar across the capsule's middle.
        const [lx, ly] = target(0);
        ctx.fillStyle = "#FF5B2E";
        ctx.fillRect(w / 2 - 2, ly + 6, 4, (h / 2 - ly - 6) * 2);
        void lx;
      }
    };

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    if (reduce) {
      draw();
      kick.current = draw;
    } else {
      loop();
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    kick.current();
  }, [sealed]);

  return <canvas ref={ref} className="capsule" aria-hidden="true" />;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
