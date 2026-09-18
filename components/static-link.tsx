import type { AnchorHTMLAttributes } from 'react';

type StaticLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
};

export default function StaticLink({ href, ...props }: StaticLinkProps) {
  return <a href={href} {...props} />;
}
