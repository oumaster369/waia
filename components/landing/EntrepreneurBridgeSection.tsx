import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const copy = HOMEPAGE_COPY.entrepreneurBridge;

export function EntrepreneurBridgeSection() {
  return (
    <HomepageSection
      testId="landing-entrepreneur-bridge"
      ariaLabel="From person to builder"
      className="bg-[rgba(3,8,19,0.4)]"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 text-center">
        <SectionHeading testId="landing-entrepreneur-bridge-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-entrepreneur-bridge-body">{copy.body}</SectionBody>
      </div>
    </HomepageSection>
  );
}
