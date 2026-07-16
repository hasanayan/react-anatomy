import { withSlotAnnotations } from "./decorator";

// Preview annotations, the shape Storybook expects an addon to export.
// eslint-disable-next-line import/prefer-default-export -- Storybook resolves preview exports by name
export const decorators = [withSlotAnnotations];
