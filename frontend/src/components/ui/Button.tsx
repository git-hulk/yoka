// The one button. Every action control in the app renders through this
// component (or `buttonClass` for exotic hosts) so the control vocabulary
// can't drift: one height ramp, one radius, one set of state treatments.
//
// Variants:
//   primary     — solid accent; the page's main action (aim for one per view)
//   secondary   — white + hairline; everything else
//   ghost       — borderless quiet action (menu feet, inline cancels)
//   danger      — bordered destructive (confirm-adjacent, e.g. Delete)
//   dangerGhost — borderless destructive inside composers/rows
//
// Sizes: md = 32px (default control height), sm = 28px (compact/inline),
// lg = 36px (standalone forms, e.g. auth pages).

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dangerGhost";
export type ButtonSize = "md" | "sm" | "lg";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-md font-medium " +
  "transition disabled:pointer-events-none disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary:     "border border-accent bg-accent text-white hover:bg-accent-deep",
  secondary:   "border border-hairline bg-white text-ink hover:bg-subtle",
  ghost:       "text-ink-dim hover:bg-subtle hover:text-ink",
  danger:      "border border-pace-red/30 bg-white text-pace-red hover:bg-pace-red/5",
  dangerGhost: "text-pace-red hover:bg-pace-red/10",
};

const SIZE: Record<ButtonSize, string> = {
  md: "h-8 px-3 text-sm",
  sm: "h-7 px-2.5 text-xs",
  lg: "h-9 px-4 text-sm",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return [BASE, VARIANT[variant], SIZE[size], className].filter(Boolean).join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?:    ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "secondary", size = "md", className, type, ...rest }, ref) {
    return (
      <button
        ref={ref}
        // Explicit default: bare <button> submits forms, which is almost
        // never what a non-submit action wants.
        type={type ?? "button"}
        className={buttonClass(variant, size, className)}
        {...rest}
      />
    );
  },
);

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?:    ButtonSize;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
