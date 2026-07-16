import type { Meta as StoryMeta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";

import {
  Actions,
  Attribute,
  Badge,
  Body,
  ButtonPrimary,
  Card,
  ChartPlaceholder,
  Footer,
  Heading,
  Icon,
  Media,
  Meta,
  Subtitle,
  Text,
  Title,
} from "../components/card";

const meta: StoryMeta = {
  title: "Components/Card",
};

export default meta;

type Story = StoryObj;

function FullCard(): ReactElement {
  return (
    <Card>
      <Media>
        <div style={{ height: "100%", width: "100%" }} />
      </Media>
      <Heading>
        <Icon>◆</Icon>
        <Title>
          <Text>Production policies</Text>
          <Subtitle>example.com/production</Subtitle>
        </Title>
        <Badge>Active</Badge>
      </Heading>
      <Body>
        <ChartPlaceholder />
      </Body>
      <Footer>
        <ButtonPrimary>Deploy</ButtonPrimary>
        <Meta>⧗ Updated 2 hours ago</Meta>
      </Footer>
    </Card>
  );
}

// No `depth`, so the overlay opens on the outermost slots and the reader dives a
// level at a time; `boundary` outlines the card itself, which at the first level
// is the only zone with nothing drawn around it.
export const Anatomy: Story = {
  parameters: { slotAnnotations: { boundary: true } },
  render: () => <FullCard />,
};

// Every `data-slot` in the tree at once — the crowded static view that stresses
// the placement engine with nested regions.
export const AnatomyAllLevels: Story = {
  parameters: { slotAnnotations: { depth: "all" } },
  render: () => <FullCard />,
};

// The heading's own slots, reached by `scope`. Packed together in a row, so the
// callout labels route out to the sides with leader lines.
export const HeadingAnatomy: Story = {
  parameters: { slotAnnotations: { scope: "heading" } },
  render: () => (
    <Card>
      <Heading>
        <Icon>◆</Icon>
        <Title>
          <Text>Production policies</Text>
          <Subtitle>example.com/production</Subtitle>
        </Title>
        <Attribute label="Value">v1.2.0</Attribute>
        <Badge>Active</Badge>
        <Actions>{null}</Actions>
      </Heading>
    </Card>
  ),
};
