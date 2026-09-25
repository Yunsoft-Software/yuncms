import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { hasHorizontalOverflow, navigationTooltipPosition } from '../navigation-overflow.js';

export function OverflowTooltipLabel({
  id,
  label,
  detail = null,
  open = false,
  onOverflowChange,
}) {
  const labelRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    const element = labelRef.current;
    if (!element) return undefined;

    const measure = () => setOverflowing(hasHorizontalOverflow(element));
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [label]);

  useEffect(() => {
    onOverflowChange?.(overflowing);
  }, [onOverflowChange, overflowing]);

  useLayoutEffect(() => {
    if (!open || !overflowing) {
      setPosition(null);
      return undefined;
    }

    const update = () => {
      const anchor = labelRef.current?.closest('button');
      if (!anchor) return;
      setPosition(navigationTooltipPosition(anchor.getBoundingClientRect(), {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }));
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, overflowing]);

  return (
    <>
      <span
        ref={labelRef}
        className={`nav-item-label collection-nav-label ${overflowing ? 'is-overflowing' : ''}`}
      >
        {label}
      </span>
      {open && overflowing && position && createPortal(
        <span
          id={id}
          className="collection-nav-tooltip"
          role="tooltip"
          style={position}
        >
          <strong>{label}</strong>
          {detail && detail !== label && <small>{detail}</small>}
        </span>,
        document.body,
      )}
    </>
  );
}
