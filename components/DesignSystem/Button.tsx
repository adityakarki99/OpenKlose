import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
    size?: 'sm' | 'md' | 'lg' | 'icon';
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({
        className = '',
        variant = 'primary',
        size = 'md',
        isLoading = false,
        leftIcon,
        rightIcon,
        children,
        disabled,
        ...props
    }, ref) => {

        // Base styles
        const baseStyles = "inline-flex items-center justify-center rounded-xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ceko-accent disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]";

        // Variants
        const variants = {
            primary: "bg-ceko-accent text-white hover:bg-blue-500 shadow-lg shadow-blue-500/25 border border-transparent",
            secondary: "bg-app-surface text-app-primary hover:bg-app-surface-soft border border-app-border",
            ghost: "bg-transparent text-app-secondary hover:text-app-primary hover:bg-app-surface-muted/10",
            destructive: "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20",
            outline: "bg-transparent border border-app-border text-app-secondary hover:text-app-primary hover:border-app-border-strong"
        };

        // Sizes
        const sizes = {
            sm: "h-8 px-3 text-xs gap-1.5",
            md: "h-10 px-4 text-sm gap-2",
            lg: "h-12 px-6 text-base gap-2.5",
            icon: "h-10 w-10 p-0"
        };

        const combinedClassName = `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`;

        return (
            <button
                ref={ref}
                className={combinedClassName}
                disabled={disabled || isLoading}
                {...props}
            >
                {isLoading && <Loader2 className="animate-spin" size={size === 'sm' ? 14 : 18} />}
                {!isLoading && leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
                {children}
                {!isLoading && rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
            </button>
        );
    }
);

Button.displayName = 'Button';
