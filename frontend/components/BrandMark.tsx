/** TrialPledge mark: a two-tone capsule on a petrol tile, with a tick for a kept promise. */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="TrialPledge">
      <rect width="32" height="32" rx="9" fill="#0F2A3D" />
      <g transform="rotate(-38 16 16)">
        <path d="M9 12.4h7v7.2H9a3.6 3.6 0 0 1 0-7.2Z" fill="#FFFFFF" />
        <path d="M16 12.4h7a3.6 3.6 0 0 1 0 7.2h-7Z" fill="#E0533D" />
      </g>
      <circle cx="24.6" cy="24.6" r="4.6" fill="#0F9D8A" stroke="#0F2A3D" strokeWidth="1.2" />
      <path d="M22.6 24.7l1.4 1.4 2.6-2.8" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
