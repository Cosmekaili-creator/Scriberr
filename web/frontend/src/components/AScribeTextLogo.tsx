import { useTheme } from "@/contexts/ThemeContext";

export function AScribeTextLogo({ className = "" }: { className?: string }) {
  const { theme } = useTheme();
  const fillColor = theme === 'dark' ? '#ede9e3' : '#1a1616';

  return (
    <svg
      viewBox="178.35 60.52 323.3 99.05"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} transition-all duration-300`}
      aria-label="aScribe"
    >
      <g transform="translate(340, 110)" textAnchor="middle">
        <text
          x="0"
          y="0"
          fontFamily="'Palatino Linotype', 'Palatino', 'Book Antiqua', Georgia, serif"
          fontSize="96"
          fontWeight="400"
          letterSpacing="2"
          dominantBaseline="middle"
          textAnchor="middle"
          fill={fillColor}
        >
          aScribe
        </text>
        <line
          x1="-114"
          y1="44"
          x2="114"
          y2="44"
          stroke={fillColor}
          strokeWidth="0.6"
          opacity="0.25"
        />
      </g>
    </svg>
  );
}
