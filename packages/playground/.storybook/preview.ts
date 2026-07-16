import { decorators } from "@react-anatomy/storybook/preview";
import type { Preview } from "@storybook/react-vite";

// The addon's decorator, consumed through its public `./preview` entry. It reads
// the `slotAnnotations` story parameter and derives the root breadcrumb from the
// story context.
const preview: Preview = {
  decorators,
};

export default preview;
