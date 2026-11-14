export function makeVideoDraggable(inset, player, controls) {
  let corner = 'bottom-right';
  let position = { x: 1, y: 1 };
  let drag = null;
  const margin = 12;
  const snapDistance = 64;

  function bounds() {
    return {
      left: margin,
      top: margin,
      right: Math.max(margin, player.clientWidth - inset.offsetWidth - margin),
      bottom: Math.max(margin, player.clientHeight - inset.offsetHeight - controls.offsetHeight - 8),
    };
  }

  function move(x, y) {
    const b = bounds();
    x = Math.max(b.left, Math.min(b.right, x));
    y = Math.max(b.top, Math.min(b.bottom, y));
    inset.style.left = `${x}px`;
    inset.style.top = `${y}px`;
    inset.style.right = 'auto';
    inset.style.bottom = 'auto';
    position = {
      x: (x - b.left) / (b.right - b.left || 1),
      y: (y - b.top) / (b.bottom - b.top || 1),
    };
  }

  function layout() {
    if (drag) return;
    const b = bounds();
    if (corner) {
      move(corner.endsWith('right') ? b.right : b.left, corner.startsWith('bottom') ? b.bottom : b.top);
    } else {
      move(b.left + position.x * (b.right - b.left), b.top + position.y * (b.bottom - b.top));
    }
  }

  inset.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = inset.getBoundingClientRect();
    drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    inset.setPointerCapture(event.pointerId);
    inset.classList.add('dragging');
  });

  inset.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const rect = player.getBoundingClientRect();
    corner = null;
    move(event.clientX - rect.left - drag.dx, event.clientY - rect.top - drag.dy);
  });

  function finish(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    inset.classList.remove('dragging');
    const b = bounds();
    const x = inset.offsetLeft;
    const y = inset.offsetTop;
    const horizontal = Math.abs(x - b.left) <= Math.abs(x - b.right) ? 'left' : 'right';
    const vertical = Math.abs(y - b.top) <= Math.abs(y - b.bottom) ? 'top' : 'bottom';
    if (Math.abs(x - b[horizontal]) <= snapDistance && Math.abs(y - b[vertical]) <= snapDistance) {
      corner = `${vertical}-${horizontal}`;
    }
    if (inset.hasPointerCapture(event.pointerId)) inset.releasePointerCapture(event.pointerId);
    layout();
  }
  inset.addEventListener('pointerup', finish);
  inset.addEventListener('pointercancel', finish);
  inset.addEventListener('lostpointercapture', finish);
  inset.addEventListener('dragstart', event => event.preventDefault());
  const observer = new ResizeObserver(layout);
  observer.observe(player);
  observer.observe(inset);
  observer.observe(controls);
  layout();
}
