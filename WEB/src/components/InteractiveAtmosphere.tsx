import { useEffect, useRef } from "react";

export default function InteractiveAtmosphere() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cursor = cursorRef.current;
    if (!cursor || !finePointer.matches) return;

    const root = document.documentElement;
    root.classList.add("has-osin-cursor");
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      cursor.style.setProperty("--cursor-x", `${event.clientX}px`);
      cursor.style.setProperty("--cursor-y", `${event.clientY}px`);
      cursor.classList.add("is-visible");
      const target = event.target instanceof Element ? event.target : null;
      cursor.classList.toggle("is-hover", Boolean(target?.closest("a,button")));
    };
    const leave = () => cursor.classList.remove("is-visible", "is-hover");
    const updateMotion = () => cursor.classList.toggle("motion-off", reducedMotion.matches);
    updateMotion();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerleave", leave);
    reducedMotion.addEventListener("change", updateMotion);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerleave", leave);
      reducedMotion.removeEventListener("change", updateMotion);
      root.classList.remove("has-osin-cursor");
    };
  }, []);

  return (
    <div className="osien-cursor" ref={cursorRef} aria-hidden="true">
      <span className="osien-cursor__ring" />
    </div>
  );
}
