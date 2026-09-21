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
  sm: { logo: "h-10 w-[104px]", mark: "h-9 w-9", label: "text-[10px]" },
  md: { logo: "h-12 w-[126px]", mark: "h-10 w-10", label: "text-xs" },
  lg: { logo: "h-14 w-[148px]", mark: "h-12 w-12", label: "text-sm" },
};

export function AppLogo({
  size = "md",
  showText = true,
  label = "Client Panel",
  textClassName = "text-foreground",
  to = "/",
  className = "",
}: AppLogoProps) {
  const { logo, mark, label: labelSize } = sizeMap[size];
  const logoSurface = textClassName.includes("text-white")
    ? "rounded-md bg-white px-2"
    : "";

  const content = showText ? (
    <>
      <img
        src="/shipsy-logo.png"
        alt="ShipSy - Shipping, Simplified."
        className={`${logo} ${logoSurface} shrink-0 object-contain object-left`}
      />
      {label && (
        <span
          className={`${labelSize} whitespace-nowrap border-l border-current/20 pl-3 font-semibold uppercase tracking-[0.14em] ${textClassName}`}
        >
          {label}
        </span>
      )}
    </>
  ) : (
    <span className={`${mark} inline-flex shrink-0 overflow-hidden`} aria-label="ShipSy">
      <img
        src="/shipsy-logo.png"
        alt=""
        className="h-full w-auto max-w-none object-contain object-left"
      />
    </span>
  );

  const classes = `inline-flex items-center gap-3 no-underline ${className}`;

  if (to) {
    return (
      <Link to={to} className={classes} aria-label="ShipSy home">
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
