interface LogoProps {
  size?: number
  className?: string
  title?: string
}

/**
 * Small original mark for DSH Remote: a terminal window with a prompt glyph.
 * It intentionally does not reuse any official DeepSeek Harness artwork.
 */
export default function Logo({ size = 22, className, title }: LogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={title ?? 'DSH Remote 标志'}
      focusable="false"
    >
      <rect
        x="2.75"
        y="3.75"
        width="18.5"
        height="16.5"
        rx="4.25"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7.1 9.1 10.2 12l-3.1 2.9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.3 15h4.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}