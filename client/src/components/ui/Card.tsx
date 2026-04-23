import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass rounded-xl p-5 ${onClick ? 'cursor-pointer hover:border-cherry-500/40 transition-colors' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
