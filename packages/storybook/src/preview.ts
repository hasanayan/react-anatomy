import { withSlotAnnotations } from "./decorator";

// Preview annotations, the shape Storybook expects an addon to export. A host
// applies the overlay by spreading this into its own `.storybook/preview`, or —
// once the package is listed in `main.addons` — by letting Storybook pick the
// decorator up from here automatically. Either way there is one decorator, and
// it reads the `slotAnnotations` story parameter.
// eslint-disable-next-line import/prefer-default-export -- Storybook resolves preview exports by name
export const decorators = [withSlotAnnotations];
