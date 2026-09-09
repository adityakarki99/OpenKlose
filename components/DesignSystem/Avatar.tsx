import React from 'react';
import { User } from 'lucide-react';

interface AvatarProps {
    src?: string | null;
    alt?: string;
    fallback?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
}

export const Avatar = ({
    src,
    alt = 'Avatar',
    fallback,
    size = 'md',
    className = ''
}: AvatarProps) => {

    const sizes = {
        sm: "w-8 h-8 text-[10px]",
        md: "w-10 h-10 text-xs",
        lg: "w-16 h-16 text-base",
        xl: "w-24 h-24 text-xl"
    };

    return (
        <div className={`relative inline-flex shrink-0 overflow-hidden rounded-full ${sizes[size]} ${className}`}>
            {src ? (
                <img
                    src={src}
                    alt={alt}
                    className="aspect-square h-full w-full object-cover"
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center border border-app-border bg-app-surfaceSoft text-app-muted">
                    {fallback ? (
                        <span className="font-semibold">{fallback.slice(0, 2).toUpperCase()}</span>
                    ) : (
                        <User className="h-[60%] w-[60%]" strokeWidth={1.5} />
                    )}
                </div>
            )}
        </div>
    );
};
