import { memo } from 'react';
import type { CSSProperties, ButtonHTMLAttributes, ReactNode, MouseEvent } from 'react';
import { useWebHaptics } from './useWebHaptics';

type TriggerInput = Parameters<ReturnType<typeof useWebHaptics>['trigger']>[0];

// Hoisted: stable object identities across renders (no per-render allocs)
const LABEL_STYLE: CSSProperties = { display: 'inline-block', cursor: 'pointer' };
const INPUT_STYLE: CSSProperties = {
  position: 'absolute',
  opacity: 0,
  width: 1,
  height: 1,
  pointerEvents: 'none',
};
const BUTTON_STYLE: CSSProperties = {
  all: 'unset',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '12px 20px',
  background: '#27272a',
  color: '#fafafa',
  borderRadius: '10px',
  border: '1px solid #3f3f46',
  font: 'inherit',
  fontWeight: 600,
  touchAction: 'manipulation',
  width: '100%',
};

export interface HapticButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  children: ReactNode;
  effect?: TriggerInput;
  onClick?: (e: MouseEvent<HTMLLabelElement>) => void;
}

/**
 * iOS-native haptic button: the tap lands on a <label> wrapping a hidden
 * native switch — the only trusted-activation Taptic path (iOS 18+).
 * Memoized leaf: re-renders only when its own props change.
 */
function HapticButtonImpl({
  children,
  effect = 'medium',
  onClick,
  ...rest
}: HapticButtonProps) {
  const { trigger } = useWebHaptics();

  return (
    <label
      className="haptic-button-label"
      style={LABEL_STYLE}
      onClick={(e) => {
        void trigger(effect);
        onClick?.(e);
      }}
    >
      <input
        type="checkbox"
        ref={(el) => el?.setAttribute('switch', '')}
        style={INPUT_STYLE}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button type="button" style={BUTTON_STYLE} {...rest}>
        {children}
      </button>
    </label>
  );
}

export const HapticButton = memo(HapticButtonImpl);
