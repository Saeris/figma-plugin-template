/**
 * A minimal Figma-styled text/number input. Same rationale as `Button` — vendored
 * locally, styled with `--figma-color-*` variables. Seed for the future component
 * library.
 */

import type { InputHTMLAttributes, JSX } from "react";
import "./Input.css";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = ({ className, ...props }: InputProps): JSX.Element => (
  <input className={`fk-input${className ? ` ${className}` : ""}`} {...props} />
);
