// First breadcrumb's name; the DOM has none, so Storybook supplies it. A scope
// wins when present (it is the root), else the story title's last segment.
// eslint-disable-next-line import/prefer-default-export -- the decorator imports this by name
export function rootLabelFor(title: string, scope: string | undefined): string {
  return scope ?? title.split("/").at(-1) ?? "component";
}
