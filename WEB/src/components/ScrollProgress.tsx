import { useEffect, useRef } from "react";

const arcs = [44, 76, 108, 140, 172];
const wave = Array.from({ length: 145 }, (_, index) => {
  const x = index * 10;
  const y = 30 + Math.sin(x * 0.018) * 10;
  return `${index === 0 ? "M" : "L"} ${x} ${y.toFixed(2)}`;
}).join(" ");

export default function ScrollProgress() {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    let frame = 0;

    const draw = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      path.style.strokeDashoffset = `${length * (1 - progress)}`;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <div className="scroll-wave" aria-hidden="true">
      <svg viewBox="0 0 1440 56" preserveAspectRatio="none">
        <defs>
          <linearGradient id="scroll-wave-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#b89aff" />
            <stop offset="100%" stopColor="#80d9e8" />
          </linearGradient>
        </defs>
        {arcs.map((radius) => (
          <path className="scroll-wave__arc" key={radius} d={`M ${720 - radius} 56 A ${radius} ${radius} 0 0 1 ${720 + radius} 56`} />
        ))}
        <path ref={pathRef} className="scroll-wave__progress" d={wave} />
      </svg>
    </div>
  );
}
