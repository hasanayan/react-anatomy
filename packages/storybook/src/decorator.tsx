import { SlotAnnotations } from "@react-anatomy/core";
import type { ReactRenderer } from "@storybook/react-vite";
import type { ReactElement } from "react";
import type { DecoratorFunction } from "storybook/internal/csf";

import type { SlotAnnotationsParameter } from "./types";

// What the first breadcrumb is called.
//
// The overlay cannot answer this: it knows the DOM, and the DOM has no name for
// the thing the slots belong to — that is exactly why `boundary` has to draw an
// outline rather than a labelled zone. Storybook does know, so the decorator
// answers it instead of adding a parameter for the story to repeat.
//
// A scope wins when there is one, because the scope *is* the root: with
// `scope: "heading"` the first level is the heading's own slots, and calling
// that crumb "Card" would name a level the reader cannot navigate to. Otherwise
// the story's component title, whose last segment ("Core/Card" → "Card") is the
// name the reader already used to get here.
function rootLabelFor(title: string, scope: string | undefined): string {
  return scope ?? title.split("/").at(-1) ?? "component";
}

// Reads the `slotAnnotations` story parameter. When unset the story renders
// untouched; otherwise it is wrapped in the overlay with the given scope.
// eslint-disable-next-line import/prefer-default-export -- barrel re-exports this by name
export const withSlotAnnotations: DecoratorFunction<ReactRenderer> = (
  Story,
  context,
): ReactElement => {
  const parameter = context.parameters["slotAnnotations"] as
    SlotAnnotationsParameter | undefined;

  if (!parameter) {
    return <Story />;
  }

  const options = parameter === true ? {} : parameter;

  return (
    <SlotAnnotations
      scope={options.scope}
      depth={options.depth}
      boundary={options.boundary}
      rootLabel={rootLabelFor(context.title, options.scope)}
    >
      <Story />
    </SlotAnnotations>
  );
};
