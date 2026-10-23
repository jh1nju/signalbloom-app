import React from 'react';

interface SignalBloomLogoProps {
  className?: string;
  size?: number;
}

export const SignalBloomLogo: React.FC<SignalBloomLogoProps> = ({ className = '', size = 36 }) => {
  return (
    <img
      src="/assets/aistudio/signalbloom-logo_af397f27.png"
      alt="SignalBloom logo"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
};
