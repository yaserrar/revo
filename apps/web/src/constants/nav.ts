import { Category2, Chart, Element3, Hierarchy } from 'iconsax-react';

/** Top navigation. Pages live under app/(app)/. */
export const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: Element3 },
  { href: '/prs', label: 'Pull requests', icon: Hierarchy },
  { href: '/repos', label: 'Repos', icon: Category2 },
  { href: '/trends', label: 'Trends', icon: Chart },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];

export function isNavActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
