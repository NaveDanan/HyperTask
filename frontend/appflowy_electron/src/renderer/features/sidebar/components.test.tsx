import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MouseEvent } from 'react';
import { ActionListPopover, FlowyTextField, MenuItem, SbIconButton, hintTooltip, showLoading } from './components';
import { showDialog } from '@/ui';

vi.mock('@/ui', () => ({
  AppFlowyPopover: () => null,
  Tooltip: () => null,
  showDialog: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('sidebar compatibility helpers', () => {
  it('stops row propagation before running an icon action', () => {
    const calls: string[] = [];
    const event = { stopPropagation: () => calls.push('stop') } as unknown as MouseEvent<HTMLButtonElement>;
    const button = SbIconButton({ icon: null, onPressed: (received) => {
      expect(received).toBe(event);
      calls.push('action');
    } });
    button.props.onClick(event);
    expect(calls).toEqual(['stop', 'action']);
  });

  it('keeps an icon without an action safe to click and retains selected state', () => {
    const stopPropagation = vi.fn();
    const button = SbIconButton({ icon: null, isSelected: true });
    button.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(button.props['data-selected']).toBe('true');
  });

  it('keeps disabled menu actions disabled as native buttons', () => {
    const action = vi.fn();
    const markup = renderToStaticMarkup(MenuItem({ name: 'Delete', danger: true, disabled: true, onTap: action }));
    expect(markup).toContain('type="button"');
    expect(markup).toContain('disabled=""');
    expect(action).not.toHaveBeenCalled();
  });

  it('passes enabled menu actions through unchanged', () => {
    const action = vi.fn();
    const row = MenuItem({ name: 'Rename', onTap: action });
    row.props.onClick();
    expect(action).toHaveBeenCalledOnce();
  });

  it('keeps popover controller lifecycle and nested close callbacks', () => {
    const close = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const controllerRef = { current: null };
    const popup = vi.fn(() => null);
    const popover = ActionListPopover({ children: null, popup, controllerRef, onOpen, onClose, asBarrier: true });
    expect(popover.props.controllerRef).toBe(controllerRef);
    expect(popover.props.onOpen).toBe(onOpen);
    expect(popover.props.onClose).toBe(onClose);
    expect(popover.props.asBarrier).toBe(true);
    popover.props.popup(close);
    expect(popup).toHaveBeenCalledWith(close);
  });

  it('preserves text change, Enter submission, and blur cancellation values', () => {
    const onChanged = vi.fn();
    const onSubmitted = vi.fn();
    const onCanceled = vi.fn();
    const input = FlowyTextField({ onChanged, onSubmitted, onCanceled, value: 'Page', autoFocus: false });
    input.props.onChange({ target: { value: 'Renamed' } });
    input.props.onKeyDown({ key: 'Escape', currentTarget: { value: 'Renamed' } });
    expect(onSubmitted).not.toHaveBeenCalled();
    input.props.onKeyDown({ key: 'Enter', currentTarget: { value: 'Renamed' } });
    input.props.onBlur({ currentTarget: { value: 'Renamed' } });
    expect(onChanged).toHaveBeenCalledWith('Renamed');
    expect(onSubmitted).toHaveBeenCalledWith('Renamed');
    expect(onCanceled).toHaveBeenCalledWith('Renamed');
  });

  it.each([true, false])('preserves deferred autofocus and selectAll=%s', (selectAll) => {
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const inputRef = { current: null };
    const element = { dataset: {}, value: 'Page', focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn() };
    const input = FlowyTextField({ inputRef, selectAll });
    input.props.ref(element);
    expect(inputRef.current).toBe(element);
    expect(element.focus).not.toHaveBeenCalled();
    requestFrame.mock.calls[0][0]();
    expect(element.focus).toHaveBeenCalledOnce();
    if (selectAll) expect(element.select).toHaveBeenCalledOnce();
    else expect(element.setSelectionRange).toHaveBeenCalledWith(4, 4);
    input.props.ref(element);
    expect(requestFrame).toHaveBeenCalledOnce();
  });

  it('does not steal focus when autofocus is disabled', () => {
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const inputRef = vi.fn();
    const element = { dataset: {}, value: 'Page' };
    FlowyTextField({ inputRef, autoFocus: false }).props.ref(element);
    expect(inputRef).toHaveBeenCalledWith(element);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('retains the label and every shortcut key in rich tooltips', () => {
    const markup = renderToStaticMarkup(hintTooltip('Search', 'Ctrl+P'));
    expect(markup).toContain('Search');
    expect(markup).toMatch(new RegExp('<kbd[^>]*>Ctrl</kbd>'));
    expect(markup).toMatch(new RegExp('<kbd[^>]*>P</kbd>'));
  });

  it('keeps the loading overlay non-dismissible and returns its closer', () => {
    const close = vi.fn();
    vi.mocked(showDialog).mockReturnValue(close);
    expect(showLoading()).toBe(close);
    expect(showDialog).toHaveBeenCalledWith(expect.any(Function), {
      barrierColor: 'transparent', barrierDismissible: false,
    });
  });
});
