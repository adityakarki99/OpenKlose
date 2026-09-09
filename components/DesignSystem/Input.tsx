import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({
        className = '',
        containerClassName = '',
        label,
        error,
        leftIcon,
        rightIcon,
        disabled,
        id,
        ...props
    }, ref) => {

        // Generate unique ID if not provided but label exists
        const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

        return (
            <div className={`w-full ${containerClassName}`}>
                {label && (
                    <label
                        htmlFor={inputId}
                        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-app-muted"
                    >
                        {label}
                    </label>
                )}

                <div className="relative group">
                    {leftIcon && (
                        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-subtle transition-colors group-focus-within:text-ceko-accent">
                            {leftIcon}
                        </div>
                    )}

                    <input
                        ref={ref}
                        id={inputId}
                        disabled={disabled}
                        className={`
              w-full rounded-xl border border-app-border bg-app-surface
              py-2.5 text-sm text-app-primary placeholder:text-app-subtle
              focus:outline-none focus:ring-2 focus:ring-ceko-accent/50 focus:border-ceko-accent/50
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-200
              ${leftIcon ? 'pl-10' : 'pl-4'}
              ${rightIcon ? 'pr-10' : 'pr-4'}
              ${error ? 'border-red-500/50 focus:ring-red-500/20 focus:border-red-500/50' : 'hover:border-app-borderStrong'}
              ${className}
            `}
                        {...props}
                    />

                    {rightIcon && (
                        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-app-subtle">
                            {rightIcon}
                        </div>
                    )}
                </div>

                {error && (
                    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-red-400 inline-block" />
                        {error}
                    </p>
                )}
            </div>
        );
    }
);

Input.displayName = 'Input';
