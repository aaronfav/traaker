import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70",
  {
    variants: {
      variant: {
        default: "bg-cyan-400 text-slate-950 hover:bg-cyan-300",
        secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700",
        outline: "border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-900",
        ghost: "text-slate-300 hover:bg-slate-900 hover:text-slate-50",
        danger: "bg-rose-500 text-white hover:bg-rose-400",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
