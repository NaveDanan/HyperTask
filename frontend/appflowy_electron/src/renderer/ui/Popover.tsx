import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';

export type PopoverDirection =
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | 'center'
  | 'topWithLeftAligned'
  | 'topWithCenterAligned'
  | 'topWithRightAligned'
  | 'rightWithTopAligned'
  | 'rightWithCenterAligned'
  | 'rightWithBottomAligned'
  | 'bottomWithLeftAligned'
  | 'bottomWithCenterAligned'
  | 'bottomWithRightAligned'
  | 'leftWithTopAligned'
  | 'leftWithCenterAligned'
  | 'leftWithBottomAligned';

export interface Offset {
  x: number;
  y: number;
}

/** PopoverDirection layout (appflowy_popover/lib/src/layout.dart): no flipping, then clamp. */
export function layoutPopover(
  direction: PopoverDirection,
  anchor: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number },
  window: { width: number; height: number },
  padding: number,
): Offset {
  const { width: w, height: h } = size;
  const cx = (anchor.left + anchor.right) / 2;
  const cy = (anchor.top + anchor.bottom) / 2;
  const table: Record<PopoverDirection, Offset> = {
    topLeft: { x: anchor.left - w, y: anchor.top - h },
    topRight: { x: anchor.right, y: anchor.top - h },
    bottomLeft: { x: anchor.left - w, y: anchor.bottom },
    bottomRight: { x: anchor.right, y: anchor.bottom },
    center: { x: cx, y: cy },
    topWithLeftAligned: { x: anchor.left, y: anchor.top - h },
    topWithCenterAligned: { x: cx - w / 2, y: anchor.top - h },
    topWithRightAligned: { x: anchor.right - w, y: anchor.top - h },
    bottomWithLeftAligned: { x: anchor.left, y: anchor.bottom },
    bottomWithCenterAligned: { x: cx - w / 2, y: anchor.bottom },
    bottomWithRightAligned: { x: anchor.right - w, y: anchor.bottom },
    rightWithTopAligned: { x: anchor.right, y: anchor.top },
    rightWithCenterAligned: { x: anchor.right, y: cy - h / 2 },
    rightWithBottomAligned: { x: anchor.right, y: anchor.bottom - h },
    leftWithTopAligned: { x: anchor.left - w, y: anchor.top },
    leftWithCenterAligned: { x: anchor.left - w, y: cy - h / 2 },
    leftWithBottomAligned: { x: anchor.left - w, y: anchor.bottom - h },
  };
  const p = table[direction];
  return {
    x: Math.min(Math.max(p.x, padding), Math.max(padding, padding + window.width - 2 * padding - w)),
    y: Math.min(Math.max(p.y, padding), Math.max(padding, padding + window.height - 2 * padding - h)),
  };
}

// The global popover stack (root overlay): an outside click pops entries until a barrier.
interface Entry {
  id: number;
  asBarrier: boolean;
  close: () => void;
  canClose?: () => Promise<boolean> | boolean;
}
const stack: Entry[] = [];
const stackListeners = new Set<() => void>();
const notifyStack = () => stackListeners.forEach((l) => l());

async function popEntries(useCanClose: boolean) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (useCanClose && top.canClose && !(await top.canClose())) return;
  // canClose may await while another action replaces the topmost popover.
  if (stack[stack.length - 1] !== top) return;
  while (stack.length) {
    // React removes effect registrations asynchronously. Detach before calling close,
    // otherwise the same entry is closed forever in this synchronous loop.
    const entry = stack.pop();
    if (!entry) break;
    entry.close();
    if (entry.asBarrier) break;
  }
  notifyStack();
}

/** PopoverMutex: at most one open popover per mutex. */
export class PopoverMutex {
  private current: (() => void) | null = null;
  claim(close: () => void) {
    if (this.current && this.current !== close) this.current();
    this.current = close;
  }
  release(close: () => void) {
    if (this.current === close) this.current = null;
  }
  close() {
    this.current?.();
    this.current = null;
  }
}

export interface PopoverController {
  show(): void;
  showAt(position: Offset): void;
  close(): void;
  isOpen(): boolean;
}

const PopoverContext = createContext<{ close: () => void; closeAll: () => void } | null>(null);
/** PopoverContainer.of(context): closes the popover from inside its content. */
export const usePopoverContainer = () => useContext(PopoverContext);

export interface PopoverProps {
  children: ReactNode;
  popup: (close: () => void) => ReactNode;
  controllerRef?: Ref<PopoverController>;
  direction?: PopoverDirection;
  offset?: Offset;
  /** 'click' opens on mouse-down (PopoverClickHandler.listener); 'none' = controller only. */
  trigger?: Array<'click' | 'hover' | 'secondaryClick'> | 'none';
  mutex?: PopoverMutex;
  windowPadding?: number;
  asBarrier?: boolean;
  showAtCursor?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  canClose?: () => Promise<boolean> | boolean;
  /** Content container styling (AppFlowyPopover adds the decoration). */
  containerStyle?: CSSProperties;
  containerClassName?: string;
  /** Lets the trigger element size itself (e.g. flex children). */
  triggerStyle?: CSSProperties;
}

let nextId = 1;

/** Popover (packages/appflowy_popover). */
export function Popover({
  children,
  popup,
  controllerRef,
  direction = 'rightWithTopAligned',
  offset = { x: 0, y: 0 },
  trigger = ['click'],
  mutex,
  windowPadding = 0,
  asBarrier = false,
  showAtCursor = false,
  onOpen,
  onClose,
  canClose,
  containerStyle,
  containerClassName,
  triggerStyle,
}: PopoverProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ cursor: Offset | null } | null>(null);
  const idRef = useRef(nextId++);
  const openRef = useRef(false);
  openRef.current = open !== null;

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(null);
  }, []);

  const show = useCallback(
    (cursor: Offset | null) => {
      onOpen?.();
      mutex?.claim(close);
      openRef.current = true;
      setOpen({ cursor });
    },
    [close, mutex, onOpen],
  );

  useImperativeHandle(controllerRef, () => ({
    show: () => show(null),
    showAt: (position) => show(position),
    close,
    isOpen: () => openRef.current,
  }));

  // Register in the global stack while open.
  useEffect(() => {
    if (!open) return;
    const entry: Entry = { id: idRef.current, asBarrier, close, canClose };
    stack.push(entry);
    notifyStack();
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      mutex?.release(close);
      notifyStack();
      onClose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open !== null]);

  const triggers = trigger === 'none' ? [] : trigger;
  return (
    <>
      <div
        ref={triggerRef}
        className="contents"
        style={triggerStyle}
        onMouseDown={(event) => {
          const primary = event.button === 0 && triggers.includes('click');
          const secondary = event.button === 2 && triggers.includes('secondaryClick');
          if (!primary && !secondary) return;
          if (openRef.current) close();
          else show(showAtCursor ? { x: event.clientX, y: event.clientY } : null);
        }}
        onContextMenu={triggers.includes('secondaryClick') ? (event) => event.preventDefault() : undefined}
        onMouseEnter={() => {
          if (triggers.includes('hover') && !openRef.current) show(null);
        }}
      >
        {children}
      </div>
      {open && (
        <PopoverOverlay
          id={idRef.current}
          anchorEl={triggerRef.current}
          cursor={open.cursor}
          direction={direction}
          offset={offset}
          windowPadding={open.cursor ? 0 : windowPadding}
          containerStyle={containerStyle}
          containerClassName={containerClassName}
          close={close}
        >
          {popup(close)}
        </PopoverOverlay>
      )}
    </>
  );
}

function PopoverOverlay({
  id,
  anchorEl,
  cursor,
  direction,
  offset,
  windowPadding,
  containerStyle,
  containerClassName,
  close,
  children,
}: {
  id: number;
  anchorEl: HTMLElement | null;
  cursor: Offset | null;
  direction: PopoverDirection;
  offset: Offset;
  windowPadding: number;
  containerStyle?: CSSProperties;
  containerClassName?: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Offset | null>(null);
  const [isFirst, setIsFirst] = useState(stack[0]?.id === id || stack.length === 0);

  useEffect(() => {
    const update = () => setIsFirst(stack[0]?.id === id);
    stackListeners.add(update);
    update();
    return () => void stackListeners.delete(update);
  }, [id]);

  const reposition = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const size = el.getBoundingClientRect();
    if (cursor) {
      setPos(
        layoutPopover(
          'bottomRight',
          { left: cursor.x + offset.x, top: cursor.y + offset.y, right: cursor.x + offset.x, bottom: cursor.y + offset.y },
          size,
          { width: window.innerWidth, height: window.innerHeight },
          0,
        ),
      );
      return;
    }
    let target = (anchorEl?.firstElementChild as HTMLElement | null) ?? anchorEl;
    // Wrappers such as Tooltip render `display: contents` and have no box; anchor to their content.
    while (target?.firstElementChild && getComputedStyle(target).display === 'contents') {
      target = target.firstElementChild as HTMLElement;
    }
    if (!target) return;
    const a = target.getBoundingClientRect();
    setPos(
      layoutPopover(
        direction,
        { left: a.left + offset.x, top: a.top + offset.y, right: a.right + offset.x, bottom: a.bottom + offset.y },
        size,
        { width: window.innerWidth, height: window.innerHeight },
        windowPadding,
      ),
    );
  }, [anchorEl, cursor, direction, offset.x, offset.y, windowPadding]);

  useLayoutEffect(() => {
    reposition();
    const observer = new ResizeObserver(reposition);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reposition);
    };
  }, [reposition]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stack[stack.length - 1]?.id === id) {
        event.stopPropagation();
        void popEntries(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id]);

  return createPortal(
    <PopoverContext.Provider value={{ close, closeAll: () => void popEntries(true) }}>
      {isFirst && (
        <div
          className="fixed inset-0 z-50"
          onMouseDown={(event) => {
            event.preventDefault();
            void popEntries(true);
          }}
          onContextMenu={(event) => event.preventDefault()}
        />
      )}
      <div
        ref={ref}
        className={cn(floatingSurfaceClass, 'fixed z-50 animate-in fade-in-0 zoom-in-95 duration-100', containerClassName)}
        style={{
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          maxWidth: `calc(100vw - ${2 * windowPadding}px)`,
          maxHeight: `calc(100vh - ${2 * windowPadding}px)`,
          ...containerStyle,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </PopoverContext.Provider>,
    document.body,
  );
}

export interface AppFlowyPopoverProps extends Omit<PopoverProps, 'containerStyle'> {
  /** Default maxWidth 240, maxHeight 600 (padding included). */
  constraints?: { minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number; width?: number };
  /** Inner padding; the old default 6 maps to the menu padding (p-1). */
  margin?: CSSProperties['padding'];
  decorationColor?: string;
  borderRadius?: number;
  /** Replaces the default decoration entirely. */
  plain?: boolean;
}

/** AppFlowyPopover (flowy_infra_ui/lib/src/flowy_overlay/appflowy_popover.dart). */
export function AppFlowyPopover({
  constraints = { maxWidth: 240, maxHeight: 600 },
  margin,
  decorationColor,
  borderRadius,
  windowPadding = 8,
  plain,
  ...props
}: AppFlowyPopoverProps) {
  const defaultPadding = margin === undefined || margin === 6 || margin === '6px';
  const color = decorationColor?.includes('var(') ? undefined : decorationColor;
  return (
    <Popover
      {...props}
      windowPadding={windowPadding}
      containerClassName={cn(plain ? 'rounded-none bg-transparent shadow-none ring-0' : 'flex flex-col overflow-auto', !plain && defaultPadding && 'p-1', props.containerClassName)}
      containerStyle={
        plain
          ? undefined
          : {
              ...constraints,
              padding: defaultPadding ? undefined : margin,
              backgroundColor: color,
              borderRadius,
            }
      }
    />
  );
}
