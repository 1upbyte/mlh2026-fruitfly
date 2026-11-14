import './video-inset.css';

export function makeVideoDraggable(inset, player, controls) {
  let corner = 'bottom-right';
  let position = { x: 1, y: 1 };
  let drag = null;
  let widthRatio = null;
  const margin = 12;
  const snapDistance = 64;
  const aspect = 16 / 9;

  for (const direction of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `video-resize ${direction}`;
    handle.dataset.direction = direction;
    handle.setAttribute('aria-label', `Resize video from ${direction.replace('-', ' ')}`);
    handle.title = 'Drag to resize';
    inset.append(handle);
  }

  function availableSize() {
    return {
      width: Math.max(1, player.clientWidth - margin * 2),
      height: Math.max(1, player.clientHeight - controls.offsetHeight - 8 - margin),
    };
  }

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
    const available = availableSize();
    const maxWidth = Math.min(available.width, available.height * aspect);
    const requestedWidth = widthRatio === null ? inset.offsetWidth : widthRatio * player.clientWidth;
    if (widthRatio !== null || requestedWidth > maxWidth) {
      inset.style.width = `${Math.max(Math.min(160, maxWidth), Math.min(maxWidth, requestedWidth))}px`;
    }
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
    const direction = event.target.closest('.video-resize')?.dataset.direction;
    drag = {
      id: event.pointerId, direction,
      dx: event.clientX - rect.left, dy: event.clientY - rect.top,
      startX: event.clientX, startY: event.clientY,
      left: inset.offsetLeft, top: inset.offsetTop, width: rect.width, height: rect.height,
    };
    inset.setPointerCapture(event.pointerId);
    inset.classList.add(direction ? 'resizing' : 'dragging');
  });

  inset.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.direction) {
      corner = null;
      const fromLeft = drag.direction.endsWith('left');
      const fromTop = drag.direction.startsWith('top');
      const right = drag.left + drag.width;
      const bottom = drag.top + drag.height;
      const widthChange = (event.clientX - drag.startX) * (fromLeft ? -1 : 1);
      const heightChange = (event.clientY - drag.startY) * (fromTop ? -1 : 1) * aspect;
      const delta = Math.abs(widthChange) >= Math.abs(heightChange) ? widthChange : heightChange;
      const maxWidth = Math.min(
        fromLeft ? right - margin : player.clientWidth - margin - drag.left,
        (fromTop ? bottom - margin : player.clientHeight - controls.offsetHeight - 8 - drag.top) * aspect,
      );
      const width = Math.max(Math.min(160, maxWidth), Math.min(maxWidth, drag.width + delta));
      inset.style.width = `${width}px`;
      widthRatio = width / player.clientWidth;
      move(fromLeft ? right - width : drag.left, fromTop ? bottom - width / aspect : drag.top);
      return;
    }
    const rect = player.getBoundingClientRect();
    corner = null;
    move(event.clientX - rect.left - drag.dx, event.clientY - rect.top - drag.dy);
  });

  function finish(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    inset.classList.remove('dragging', 'resizing');
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
  inset.addEventListener('keydown', event => {
    if (!event.target.closest('.video-resize') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const available = availableSize();
    const maxWidth = Math.min(available.width, available.height * aspect);
    const delta = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 20 : -20;
    widthRatio = Math.max(Math.min(160, maxWidth), Math.min(maxWidth, inset.offsetWidth + delta)) / player.clientWidth;
    layout();
  });
  const observer = new ResizeObserver(layout);
  observer.observe(player);
  observer.observe(inset);
  observer.observe(controls);
  layout();
}
