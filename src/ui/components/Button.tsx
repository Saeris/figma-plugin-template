/**
 * A minimal Figma-styled button. Vendored locally rather than pulled from a
 * package: the React Figma UI libraries are all stale or empty stubs, and the one
 * healthy option (`@create-figma-plugin/ui`) is Preact. Styling uses Figma's
 * `--figma-color-*` variables (injected by `showUI({ themeColors: true })`), so it
 * tracks the user's light/dark theme automatically.
 *
 * This is intentionally tiny — a seed for a future React-Aria-based component
 * library, not a full design system. Swap it out when that library exists.
 */

import type { ButtonHTMLAttributes, JSX } from "react";
import "./Button.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `brand` = filled accent (primary action); `secondary` = outlined. */
  variant?: "brand" | "secondary";
}

export const Button = ({
  variant = "secondary",
  className,
  ...props
}: ButtonProps): JSX.Element => (
  <button
    className={`fk-button fk-button--${variant}${className ? ` ${className}` : ""}`}
    {...props}
  />
);
