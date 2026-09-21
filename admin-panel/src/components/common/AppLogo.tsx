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
  sm: { logo: "h-10 w-[148px]", mark: "h-9 w-9", label: "text-[10px]" },
  md: { logo: "h-12 w-[166px]", mark: "h-10 w-10", label: "text-xs" },
  lg: { logo: "h-14 w-[190px]", mark: "h-12 w-12", label: "text-sm" },
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
    <span className="flex min-w-0 flex-col items-start gap-1">
      <img
        src="/shipsy-logo.png"
        alt="ShipSy - Shipping, Simplified."
        className={`${logo} ${logoSurface} block shrink-0 object-contain object-left`}
      />
      {label && (
        <span className={`${labelSize} whitespace-nowrap font-semibold uppercase tracking-[0.24em] ${textClassName}`}>
          {label}
        </span>
      )}
    </span>
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
    return <Link to={to} className={`flex items-center no-underline ${className}`} aria-label="Shipsy admin home">{content}</Link>;
  }

  return <div className={`flex items-center ${className}`}>{content}</div>;
}
