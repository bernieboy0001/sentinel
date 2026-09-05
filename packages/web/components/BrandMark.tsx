"use client";

export default function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="SENTINEL logo: a radar eye sweeping for signals"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="sentinel-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#45e0ff" />
        </linearGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="#171b27"
        stroke="url(#sentinel-grad)"
        strokeWidth="2.5"
      />
      <path
        d="M32 6 V14 M32 50 V58 M6 32 H14 M50 32 H58"
        stroke="#a78bfa"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle
        cx="32"
        cy="32"
        r="16"
        fill="none"
        stroke="#a78bfa"
        strokeWidth="1.5"
        opacity="0.4"
      />
      <path
        d="M32 32 L32 6 A26 26 0 0 1 50.38 13.62 Z"
        fill="#45e0ff"
        opacity="0.18"
      />
      <circle cx="32" cy="32" r="4.5" fill="#45e0ff" />
      <circle
        cx="32"
        cy="32"
        r="9"
        fill="none"
        stroke="#45e0ff"
        strokeWidth="1.5"
        opacity="0.55"
      />
    </svg>
  );
}