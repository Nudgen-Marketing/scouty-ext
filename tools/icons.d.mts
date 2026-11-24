export const ICON_SIZES: number[];
export function markPaths(brandSource: string): string[];
export function iconSvg(marks: string[]): string;
export function renderIcons(svg: string, sizes?: number[]): Promise<Map<number, Buffer>>;
