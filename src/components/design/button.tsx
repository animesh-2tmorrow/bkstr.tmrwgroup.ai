// bkstr redesign — Button primitive (HANDOFF.md §Component conventions / Buttons).
//
// Two variants only — primary (ink bg, paper text) and ghost (transparent
// bg, ink border + ink text). Three sizes (sm/md/lg). SQUARE CORNERS —
// no rounded buttons anywhere. No gradients, no shadows.
//
// Renders as <button> by default; pass `as="a"` to render as a link with
// `href`. Either way it inherits the same visual shape. (Real <a> for
// navigation, <button type="button"> for actions per accessibility.)

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-[18px] py-2.5 text-sm',
  lg: 'px-[26px] py-3.5 text-[15px]',
};

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-paper border border-ink hover:bg-ink-2 active:translate-y-px',
  ghost:
    'bg-transparent text-ink border border-ink hover:bg-ink hover:text-paper active:translate-y-px',
};

const BASE =
  'inline-flex items-center justify-center gap-2 font-sans font-medium whitespace-nowrap ' +
  'transition-[transform,background-color,color,border-color] duration-150 ' +
  // square corners — explicit, since browser default for <button> isn't square
  'rounded-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0';

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  className?: string;
};

type ButtonAsButton = CommonProps & { as?: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>;
type ButtonAsLink = CommonProps & { as: 'a' } & AnchorHTMLAttributes<HTMLAnchorElement>;
type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    children,
    className = '',
    ...rest
  } = props as CommonProps & { as?: 'button' | 'a' } & Record<string, unknown>;

  const cls = [BASE, SIZE[size], VARIANT[variant], className].join(' ').trim();

  if ((rest as { as?: string }).as === 'a') {
    // Strip the `as` discriminator from rest before spreading onto <a>.
    const { as: _a, ...anchorRest } = rest as { as?: string } & AnchorHTMLAttributes<HTMLAnchorElement>;
    void _a;
    return (
      <a className={cls} {...anchorRest}>
        {children}
      </a>
    );
  }

  // Default to <button type="button"> — `type` is critical inside forms
  // (without it, browsers treat <button> as type="submit").
  const { as: _b, type, ...buttonRest } = rest as { as?: string; type?: 'button' | 'submit' | 'reset' } & ButtonHTMLAttributes<HTMLButtonElement>;
  void _b;
  return (
    <button type={type ?? 'button'} className={cls} {...buttonRest}>
      {children}
    </button>
  );
}
