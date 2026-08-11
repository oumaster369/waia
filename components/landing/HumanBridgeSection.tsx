import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";

const copy = HOMEPAGE_COPY.humanBridge;

/** Intentional visual silence — no media slot (DEE-608 B1). */
export function HumanBridgeSection() {
  return (
    <HomepageSection testId="landing-human-bridge" ariaLabel="It starts with the human">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <SectionHeading testId="landing-human-bridge-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-human-bridge-body">{copy.body}</SectionBody>
      </div>
    </HomepageSection>
  );
}
