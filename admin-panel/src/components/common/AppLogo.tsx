import { Link } from "react-router-dom";

type LogoSize = "sm" | "md" | "lg";

interface AppLogoProps {
  size?: LogoSize;
  showText?: boolean;
  label?: string;
  textClassName?: string;
  to?: string;
  className?: string;
}

const sizeMap: Record<LogoSize, { logo: string; mark: string; label: string }> = {
  sm: { logo: "h-10 w-[112px]", mark: "h-9 w-9", label: "text-xs" },
  md: { logo: "h-12 w-[138px]", mark: "h-10 w-10", label: "text-sm" },
  lg: { logo: "h-14 w-[164px]", mark: "h-12 w-12", label: "text-base" },
};

export function AppLogo({
  size = "md",
  showText = true,
  label = "Admin Panel",
  textClassName = "text-foreground",
  to = "/",
  className = "",
}: AppLogoProps) {
  const { logo, mark, label: labelSize } = sizeMap[size];
  const logoSurface = "rounded-md bg-white px-2 py-1";

  const content = showText ? (
    <>
      <img
        src="/shipsy-logo.png"
        alt="ShipSy - Shipping, Simplified."
        className={`${logo} ${logoSurface} shrink-0 object-contain object-left`}
      />
      {label && (
        <span className={`${labelSize} whitespace-nowrap border-l border-current/20 pl-3 font-semibold uppercase tracking-[0.18em] ${textClassName}`}>
          {label}
        </span>
      )}
    </>
  ) : (
    <span className={`${mark} ${logoSurface} inline-flex shrink-0 overflow-hidden`} aria-label="ShipSy">
      <img
        src="/shipsy-logo.png"
        alt=""
        className="h-full w-auto max-w-none object-contain object-left"
      />
    </span>
  );

  if (to) {
    return (
      <Link to={to} className={`flex items-center gap-2.5 no-underline ${className}`} aria-label="Shipsy admin home">
        {content}
      </Link>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {content}
    </div>
  );
}
