import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionStack,
} from "@/components/landing/homepage-section";

const copy = HOMEPAGE_COPY.humanBridge;

/** Intentional visual silence — bridge density (DEE-608 B1 / rhythm pass). */
export function HumanBridgeSection() {
  return (
    <HomepageSection
      testId="landing-human-bridge"
      ariaLabel="It starts with the human"
      density="bridge"
    >
      <SectionStack className="mx-auto max-w-3xl">
        <SectionHeading testId="landing-human-bridge-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-human-bridge-body">{copy.body}</SectionBody>
      </SectionStack>
    </HomepageSection>
  );
}
