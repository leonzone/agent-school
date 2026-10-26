import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { navigate, useLocation } from "../router";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  children: ReactNode;
};

export function Link({ to, children, onClick, ...props }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || props.target === "_blank"
    ) return;
    event.preventDefault();
    navigate(to);
  }

  return <a href={to} onClick={handleClick} {...props}>{children}</a>;
}

type NavLinkProps = LinkProps & {
  activeWhen?: (pathname: string) => boolean;
};

export function NavLink({ activeWhen, ...props }: NavLinkProps) {
  const { pathname } = useLocation();
  const active = activeWhen?.(pathname) ?? pathname === props.to;
  return <Link {...props} aria-current={active ? "page" : undefined} />;
}
