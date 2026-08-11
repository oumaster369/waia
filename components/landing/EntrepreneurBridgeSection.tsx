import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionStack,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const copy = HOMEPAGE_COPY.entrepreneurBridge;

export function EntrepreneurBridgeSection() {
  return (
    <HomepageSection
      testId="landing-entrepreneur-bridge"
      ariaLabel="From person to builder"
      density="bridge"
      className="bg-[rgba(3,8,19,0.4)]"
    >
      <SectionStack className="mx-auto max-w-3xl text-center">
        <SectionHeading testId="landing-entrepreneur-bridge-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-entrepreneur-bridge-body" className="mx-auto">
          {copy.body}
        </SectionBody>
      </SectionStack>
    </HomepageSection>
  );
}
