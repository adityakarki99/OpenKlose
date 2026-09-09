import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'glass' | 'ghost';
    noPadding?: boolean;
}

export const Card = ({
    className = '',
    variant = 'default',
    noPadding = false,
    children,
    ...props
}: CardProps) => {

    const variants = {
        default: "bg-app-surface border border-app-border shadow-xl shadow-slate-950/5",
        glass: "bg-app-surface/80 backdrop-blur-xl border border-app-border shadow-2xl shadow-slate-950/10",
        ghost: "bg-transparent border border-dashed border-app-border"
    };

    return (
        <div
            className={`rounded-xl overflow-hidden ${variants[variant]} ${noPadding ? '' : 'p-6'} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
