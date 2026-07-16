import { SlotAnnotations } from "@react-anatomy/core";
import type { ReactRenderer } from "@storybook/react-vite";
import type { ReactElement } from "react";
import type { DecoratorFunction } from "storybook/internal/csf";

import { rootLabelFor } from "./root-label";
import type { SlotAnnotationsParameter } from "./types";

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
      gutters={options.gutters}
      rootLabel={rootLabelFor(context.title, options.scope)}
    >
      <Story />
    </SlotAnnotations>
  );
};
