import type { SVGProps } from 'react';

/** Original outline mark; inherits the surrounding theme and button size. */
export function NotebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="5" y="3" width="15" height="18" rx="2.5" />
      <path d="M8.5 3v18M3.5 7h3M3.5 12h3M3.5 17h3M12 8h4.5M12 12h3" />
    </svg>
  );
}
