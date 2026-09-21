import React, { useState } from 'react';
import { useSettings } from '../../contexts/SettingsContext';

type ZoomLevel = 50 | 75 | 100 | 150;

interface ZoomControlProps {
    defaultZoom?: ZoomLevel;
    onZoomChange?: (zoom: ZoomLevel) => void;
    className?: string;
}

export default function VerticalZoomControl({
    defaultZoom = 100,
    onZoomChange,
    className = '',
}: ZoomControlProps) {
    const [currentZoom, setCurrentZoom] = useState<ZoomLevel>(defaultZoom);
    const { settings } = useSettings();
    const isLightMode = settings.themeMode === 'light';
    // Options ordered from high (top) to low (bottom)
    const options: ZoomLevel[] = [150, 100, 75, 50];

    const handleZoomClick = (zoom: ZoomLevel) => {
        setCurrentZoom(zoom);
        if (onZoomChange) {
            onZoomChange(zoom);
        }
    };

    // Calculate clip-path inset for the fill bar.
    // Index 0 (150%) is top (~10%), Index 3 (50%) is bottom (~90%).
    const currentIndex = options.indexOf(currentZoom);
    const maxIndex = options.length - 1;
    const rangeStart = 10; // Top limit percentage
    const rangeEnd = 90;   // Bottom limit percentage
    const fillClipTop = rangeStart + (currentIndex * ((rangeEnd - rangeStart) / maxIndex));

    return (
        <div className={`flex flex-col items-center justify-center p-6 ${className}`}>
            {/* Main Slider Container - Slimmed from w-8 to w-6 */}
            <div className="relative flex w-6 select-none flex-col rounded-2xl border border-app-border bg-app-surface-elevated py-2 shadow-xl ring-1 ring-app-border/40">

                {/* Vertical Track Line - Slimmed from w-1.5 to w-1 */}
                <div className="absolute left-1/2 -translate-x-1/2 top-3 bottom-3 w-1 pointer-events-none">
                    {/* Background Track (Dark Grey) */}
                    <svg
                        viewBox="0 0 8 100"
                        preserveAspectRatio="none"
                        className="absolute inset-0 h-full w-full fill-current text-app-border-strong opacity-80"
                    >
                        <path d="M0,0 L8,0 L5,100 L3,100 Z" />
                    </svg>

                    {/* Active Track (Blue Fill) */}
                    <div
                        className="absolute inset-0 w-full h-full text-blue-400 fill-current transition-all duration-300 ease-out"
                        style={{ clipPath: `inset(${fillClipTop}% 0 0 0)` }}
                    >
                        <svg
                            viewBox="0 0 8 100"
                            preserveAspectRatio="none"
                            className="w-full h-full"
                        >
                            <path d="M0,0 L8,0 L5,100 L3,100 Z" />
                        </svg>
                    </div>
                </div>

                {/* Interactive Buttons Layer */}
                <div className="relative flex flex-col z-10">
                    {options.map((zoom) => (
                        <button
                            key={zoom}
                            onClick={() => handleZoomClick(zoom)}
                            className="group relative flex h-8 w-full items-center justify-center outline-none focus-visible:bg-app-surface-muted/10"
                            aria-label={`Set zoom to ${zoom}%`}
                            aria-pressed={currentZoom === zoom}
                        >
                            {/* Tick Mark on Track - Adjusted widths for slim container */}
                            <div
                                className={`
                  absolute left-1/2 -translate-x-1/2 h-0.5 rounded-full transition-all duration-300
                  ${currentZoom === zoom ? 'w-1.5 bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]' : 'w-1 bg-app-border-strong group-hover:bg-app-muted'}
                `}
                            />

                            {/* Floating Text Label */}
                            <span
                                className={`
                  absolute left-full ml-3 font-bold transition-all duration-300 origin-left whitespace-nowrap drop-shadow-md
                  ${currentZoom === zoom
                                        ? 'text-app-primary text-xs translate-x-0 opacity-100'
                                        : 'text-app-subtle text-xs -translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0'
                                    }
                `}
                            >
                                {zoom}%
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Debug/Preview Info */}
            <div className="mt-4 text-center opacity-40">
                <p className="font-mono text-[9px] tracking-wider text-app-subtle">{isLightMode ? 'CANVAS' : 'ZOOM'}</p>
            </div>
        </div>
    );
}
