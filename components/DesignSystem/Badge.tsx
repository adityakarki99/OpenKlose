import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'outline' | 'secondary' | 'destructive' | 'success';
}

export const Badge = ({
    className = '',
    variant = 'default',
    children,
    ...props
}: BadgeProps) => {

    const variants = {
        default: "bg-ceko-accent/10 text-ceko-accent border-ceko-accent/20",
        outline: "bg-transparent border-app-border text-app-muted",
        secondary: "bg-app-surface text-app-secondary border-app-border",
        destructive: "bg-red-500/10 text-red-400 border-red-500/20",
        success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    };

    return (
        <div
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variants[variant]} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
